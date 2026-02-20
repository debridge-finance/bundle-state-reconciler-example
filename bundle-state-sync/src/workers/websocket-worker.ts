import WebSocket from "ws";
import pg from "pg";
import { Config } from "../config";
import {
  BundleResponse,
  ClientEvent,
  ServerEvent,
  TERMINAL_BUNDLE_STATUSES,
  isServerEnvelope,
  SubscriptionManager,
  SubscriptionManagerStats,
  WsFilterWrapper,
} from "../types";
import { upsertBundle } from "../services/bundle-store";
import {
  getNonTerminalBundleIds,
  getBundleStatuses,
} from "../services/bundle-store";
import { logger } from "../utils/logger";

// ─── Internal types ──────────────────────────────────────────────────────────

interface ManagedConnection {
  ws: WebSocket;
  subscribedIds: Set<string>;
  isAlive: boolean;
  reconnecting: boolean;
  reconnectAttempts: number;
}

// ─── WsSubscriptionManager ──────────────────────────────────────────────────

class WsSubscriptionManager implements SubscriptionManager {
  private connections: ManagedConnection[] = [];
  private bundleToConnection = new Map<string, ManagedConnection>();
  private shutdownRequested = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private pool: pg.Pool,
    private config: Config,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  async subscribe(bundleIds: string[]): Promise<void> {
    if (bundleIds.length === 0) return;

    // Group IDs by connection, assigning to existing connections with capacity
    // or creating new ones as needed
    const affectedConnections = new Set<ManagedConnection>();

    for (const id of bundleIds) {
      if (this.bundleToConnection.has(id)) continue; // already subscribed

      let conn = this.findConnectionWithCapacity();
      if (!conn) {
        conn = await this.createConnection();
      }

      conn.subscribedIds.add(id);
      this.bundleToConnection.set(id, conn);
      affectedConnections.add(conn);
    }

    // Re-send the full subscription set for each affected connection
    // (replace semantics — server clears existing subs before adding)
    for (const conn of affectedConnections) {
      this.sendSubscribe(conn);
    }
  }

  async unsubscribe(bundleIds: string[]): Promise<void> {
    if (bundleIds.length === 0) return;

    // Group by connection for targeted unsubscribe
    const byConnection = new Map<ManagedConnection, string[]>();

    for (const id of bundleIds) {
      const conn = this.bundleToConnection.get(id);
      if (!conn) continue;

      conn.subscribedIds.delete(id);
      this.bundleToConnection.delete(id);

      let ids = byConnection.get(conn);
      if (!ids) {
        ids = [];
        byConnection.set(conn, ids);
      }
      ids.push(id);
    }

    for (const [conn, ids] of byConnection) {
      this.sendUnsubscribe(conn, ids);

      // Close connections with zero subs
      if (conn.subscribedIds.size === 0) {
        this.closeConnection(conn);
      }
    }
  }

  async subscribeBatch(bundleIds: string[]): Promise<void> {
    if (bundleIds.length === 0) return;

    // Filter out already-subscribed IDs
    const newIds = bundleIds.filter((id) => !this.bundleToConnection.has(id));
    if (newIds.length === 0) return;

    const maxPerConn = this.config.wsMaxSubsPerConnection;

    // Calculate how many connections we need
    const connectionsNeeded = Math.ceil(newIds.length / maxPerConn);

    // Reuse existing connections with capacity first, create rest
    const availableConns: ManagedConnection[] = [];
    for (const conn of this.connections) {
      if (conn.subscribedIds.size < maxPerConn) {
        availableConns.push(conn);
      }
    }

    while (availableConns.length < connectionsNeeded) {
      const conn = await this.createConnection();
      availableConns.push(conn);
    }

    // Distribute IDs across connections
    let connIdx = 0;
    for (const id of newIds) {
      let conn = availableConns[connIdx];
      if (conn.subscribedIds.size >= maxPerConn) {
        connIdx++;
        conn = availableConns[connIdx];
      }
      conn.subscribedIds.add(id);
      this.bundleToConnection.set(id, conn);
    }

    // Send one subscribe per connection (replace semantics)
    const affectedConns = new Set(newIds.map((id) => this.bundleToConnection.get(id)!));
    for (const conn of affectedConns) {
      this.sendSubscribe(conn);
    }

    logger.info(
      `[ws-worker] subscribeBatch: ${newIds.length} IDs across ${affectedConns.size} connection(s)`,
    );
  }

  async pruneTerminal(terminalBundleIds: string[]): Promise<void> {
    await this.unsubscribe(terminalBundleIds);
  }

  getStats(): SubscriptionManagerStats {
    return {
      activeSubscriptions: this.bundleToConnection.size,
      totalConnections: this.connections.length,
      bundleIdsTracked: this.bundleToConnection.size,
    };
  }

  async close(): Promise<void> {
    this.shutdownRequested = true;
    this.stopHeartbeat();

    for (const conn of this.connections) {
      try {
        conn.ws.close(1000, "shutdown");
      } catch {
        // ignore close errors during shutdown
      }
    }

    this.connections = [];
    this.bundleToConnection.clear();
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const conn of this.connections) {
        if (!conn.isAlive) {
          logger.warn("[ws-worker] connection not responding to ping, terminating");
          conn.ws.terminate();
          continue;
        }
        conn.isAlive = false;
        conn.ws.ping();
      }
    }, 25_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Connection management ───────────────────────────────────────────────

  private findConnectionWithCapacity(): ManagedConnection | null {
    for (const conn of this.connections) {
      if (conn.subscribedIds.size < this.config.wsMaxSubsPerConnection) {
        return conn;
      }
    }
    return null;
  }

  private createConnection(): Promise<ManagedConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.config.debridgeWsUrl);

      const conn: ManagedConnection = {
        ws,
        subscribedIds: new Set(),
        isAlive: false,
        reconnecting: false,
        reconnectAttempts: 0,
      };

      const onOpen = () => {
        conn.isAlive = true;
        conn.reconnectAttempts = 0;
        conn.reconnecting = false;
        logger.info(
          `[ws-worker] connection established (${this.connections.length + 1} total)`,
        );
        cleanup();
        this.connections.push(conn);
        resolve(conn);
      };

      const onError = (err: Error) => {
        cleanup();
        logger.error("[ws-worker] connection error during open:", err.message);
        reject(err);
      };

      const cleanup = () => {
        ws.removeListener("open", onOpen);
        ws.removeListener("error", onError);
      };

      ws.once("open", onOpen);
      ws.once("error", onError);

      // Persistent handlers
      ws.on("message", (raw) => this.handleMessage(conn, raw));
      ws.on("pong", () => {
        conn.isAlive = true;
      });
      ws.on("close", (code, reason) => {
        logger.info(
          `[ws-worker] connection closed: code=${code} reason=${reason.toString()}`,
        );
        this.handleDisconnect(conn);
      });
      ws.on("error", (err) => {
        logger.error("[ws-worker] connection error:", err.message);
      });
    });
  }

  private closeConnection(conn: ManagedConnection): void {
    const idx = this.connections.indexOf(conn);
    if (idx !== -1) this.connections.splice(idx, 1);

    for (const id of conn.subscribedIds) {
      this.bundleToConnection.delete(id);
    }
    conn.subscribedIds.clear();

    try {
      conn.ws.close(1000, "no subscriptions");
    } catch {
      // ignore
    }
  }

  private handleDisconnect(conn: ManagedConnection): void {
    // Remove from active list
    const idx = this.connections.indexOf(conn);
    if (idx !== -1) this.connections.splice(idx, 1);

    if (this.shutdownRequested) return;

    // If it still had subscriptions, reconnect
    if (conn.subscribedIds.size > 0) {
      this.reconnect(conn);
    } else {
      // Clean up mappings
      for (const id of conn.subscribedIds) {
        this.bundleToConnection.delete(id);
      }
    }
  }

  private async reconnect(oldConn: ManagedConnection): Promise<void> {
    if (oldConn.reconnecting) return;
    oldConn.reconnecting = true;

    const idsToResubscribe = [...oldConn.subscribedIds];

    // Clear old mappings
    for (const id of oldConn.subscribedIds) {
      this.bundleToConnection.delete(id);
    }
    oldConn.subscribedIds.clear();

    const baseMs = this.config.wsReconnectBaseMs;
    const maxMs = this.config.wsReconnectMaxMs;
    let attempt = oldConn.reconnectAttempts;

    while (!this.shutdownRequested) {
      const delayMs = Math.min(baseMs * Math.pow(2, attempt), maxMs);
      logger.info(
        `[ws-worker] reconnecting in ${delayMs}ms (attempt ${attempt + 1})`,
      );

      await new Promise((r) => setTimeout(r, delayMs));
      if (this.shutdownRequested) return;

      try {
        const newConn = await this.createConnection();

        // Re-assign IDs to the new connection
        for (const id of idsToResubscribe) {
          // Only re-assign if not already subscribed elsewhere
          if (!this.bundleToConnection.has(id)) {
            newConn.subscribedIds.add(id);
            this.bundleToConnection.set(id, newConn);
          }
        }

        // Replay subscriptions
        if (newConn.subscribedIds.size > 0) {
          this.sendSubscribe(newConn);
        }

        logger.info(
          `[ws-worker] reconnected, replayed ${newConn.subscribedIds.size} subscriptions`,
        );
        return;
      } catch (err) {
        attempt++;
        logger.error(
          "[ws-worker] reconnect failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // ── Message handling ────────────────────────────────────────────────────

  private async handleMessage(
    _conn: ManagedConnection,
    raw: WebSocket.RawData,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      logger.warn("[ws-worker] received non-JSON message");
      return;
    }

    logger.debug(
      `[ws-worker] Received ${(parsed as any).event}, bundleId=${(parsed as any).data?.bundle?.bundleId ?? (parsed as any).data?.bundleId ?? 'N/A'}`,
    );

    if (!isServerEnvelope(parsed)) {
      logger.warn("[ws-worker] received unknown message format");
      return;
    }

    switch (parsed.event) {
      case ServerEvent.bundle_update: {
        const rawData = parsed.data as any;
        const bundle = (rawData.bundle ?? rawData) as BundleResponse;
        try {
          const result = await upsertBundle(this.pool, bundle, "websocket");
          logger.debug(
            `[ws-worker] bundle_update ${bundle.bundleId}: ${result}`,
          );

          // If terminal, unsubscribe
          if (
            TERMINAL_BUNDLE_STATUSES.includes(bundle.status)
          ) {
            await this.unsubscribe([bundle.bundleId]);
          }
        } catch (err) {
          logger.error(
            `[ws-worker] upsert failed for ${bundle.bundleId}:`,
            err instanceof Error ? err.message : err,
          );
        }
        break;
      }

      case ServerEvent.subscribe:
        logger.debug("[ws-worker] subscribe ack:", parsed.data);
        break;

      case ServerEvent.unsubscribed:
        logger.debug("[ws-worker] unsubscribed ack:", parsed.data);
        break;

      case ServerEvent.error:
        logger.warn("[ws-worker] server error:", parsed.data);
        break;
    }
  }

  // ── Wire protocol ──────────────────────────────────────────────────────

  private sendSubscribe(conn: ManagedConnection): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.subscribedIds.size === 0) return;

    const msg = {
      event: ClientEvent.subscribe,
      data: {
        filters: {
          bundleId: [...conn.subscribedIds],
        },
      } satisfies WsFilterWrapper,
    };

    conn.ws.send(JSON.stringify(msg));
    logger.debug(
      `[ws-worker] sent subscribe with ${conn.subscribedIds.size} IDs`,
    );
  }

  private sendUnsubscribe(conn: ManagedConnection, bundleIds: string[]): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (bundleIds.length === 0) return;

    const msg = {
      event: ClientEvent.unsubscribe,
      data: {
        filters: {
          bundleId: bundleIds,
        },
      } satisfies WsFilterWrapper,
    };

    conn.ws.send(JSON.stringify(msg));
    logger.debug(
      `[ws-worker] sent unsubscribe for ${bundleIds.length} IDs`,
    );
  }
}

// ─── Worker entry point ─────────────────────────────────────────────────────

export async function startWebSocketWorker(
  pool: pg.Pool,
  config: Config,
): Promise<{ stop: () => Promise<void> }> {
  logger.info("[ws-worker] starting...");

  const manager = new WsSubscriptionManager(pool, config);

  // Load existing non-terminal bundles and subscribe
  const nonTerminalIds = await getNonTerminalBundleIds(pool);
  if (nonTerminalIds.length > 0) {
    logger.info(
      `[ws-worker] subscribing to ${nonTerminalIds.length} existing non-terminal bundles`,
    );
    await manager.subscribeBatch(nonTerminalIds);
  }

  // Start heartbeat
  manager.startHeartbeat();

  // Periodic sync: subscribe to new non-terminal IDs, prune terminal ones
  const syncTimer = setInterval(async () => {
    try {
      const currentIds = await getNonTerminalBundleIds(pool);
      const stats = manager.getStats();

      // Subscribe to any new IDs not yet tracked
      const currentSet = new Set(currentIds);
      const newIds = currentIds.filter(
        (id) => !stats.bundleIdsTracked || !currentSet.has(id),
      );

      // Actually, we need to know which IDs are already subscribed.
      // We can use subscribe() which skips already-subscribed IDs.
      await manager.subscribe(currentIds);

      // Find terminal bundles among currently subscribed IDs
      // by checking DB statuses for all subscribed IDs
      const subscribedIds = currentIds; // approximate: all non-terminal from DB
      const statuses = await getBundleStatuses(pool, subscribedIds);
      const terminalIds: string[] = [];
      for (const [id, status] of statuses) {
        if (
          TERMINAL_BUNDLE_STATUSES.includes(status as any)
        ) {
          terminalIds.push(id);
        }
      }

      if (terminalIds.length > 0) {
        await manager.pruneTerminal(terminalIds);
        logger.debug(
          `[ws-worker] pruned ${terminalIds.length} terminal bundles`,
        );
      }

      const newStats = manager.getStats();
      logger.debug(
        `[ws-worker] sync: ${newStats.activeSubscriptions} active subs, ${newStats.totalConnections} connections`,
      );
    } catch (err) {
      logger.error(
        "[ws-worker] sync error:",
        err instanceof Error ? err.message : err,
      );
    }
  }, 30_000);

  logger.info("[ws-worker] started");

  return {
    stop: async () => {
      logger.info("[ws-worker] stopping...");
      clearInterval(syncTimer);
      await manager.close();
      logger.info("[ws-worker] stopped");
    },
  };
}
