import WebSocket, { WebSocketServer } from "ws";
import { addClient, removeClient, subscribe, unsubscribe, getStats } from "./ws-registry";
import { logger } from "../utils/logger";

function sendToClient(ws: WebSocket, event: string, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, data }));
  }
}

function handleMessage(ws: WebSocket, raw: WebSocket.RawData): void {
  let msg: { event?: string; data?: { filters?: { bundleId?: unknown } } };

  try {
    msg = JSON.parse(raw.toString());
  } catch {
    sendToClient(ws, "error", { message: "Invalid JSON" });
    return;
  }

  if (!msg.event || (msg.event !== "subscribe" && msg.event !== "unsubscribe")) {
    sendToClient(ws, "error", { message: `Unknown event: ${msg.event ?? "(none)"}` });
    return;
  }

  const bundleIds = msg.data?.filters?.bundleId;
  if (!Array.isArray(bundleIds) || !bundleIds.every((id) => typeof id === "string")) {
    sendToClient(ws, "error", { message: "data.filters.bundleId must be a string array" });
    return;
  }

  if (msg.event === "subscribe") {
    const result = subscribe(ws, bundleIds);

    if (result.rejected.length > 0) {
      sendToClient(ws, "error", {
        code: "SUBSCRIPTION_LIMIT",
        message: "Subscription limit exceeded (max 100 per connection)",
      });
    }

    if (result.accepted.length > 0) {
      sendToClient(ws, "subscribe", {
        confirm: {
          filters: { bundleId: result.accepted },
          status: "subscribed",
          timestamp: Date.now(),
        },
      });
    }
  } else {
    const result = unsubscribe(ws, bundleIds);
    sendToClient(ws, "unsubscribed", {
      confirm: {
        filters: { bundleId: result.removed },
        status: "unsubscribed",
        timestamp: Date.now(),
      },
    });
  }
}

export function startWsServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) {
        removeClient(ws);
        return ws.terminate();
      }
      (ws as any).isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (ws) => {
    (ws as any).isAlive = true;
    addClient(ws);
    logger.info(`[WS] Client connected (${getStats().totalClients} total)`);

    ws.on("pong", () => {
      (ws as any).isAlive = true;
    });

    ws.on("message", (raw) => {
      handleMessage(ws, raw);
    });

    ws.on("close", () => {
      removeClient(ws);
      logger.info(`[WS] Client disconnected (${getStats().totalClients} total)`);
    });

    ws.on("error", (err) => {
      logger.error(`[WS] Client error: ${err.message}`);
    });
  });

  return wss;
}
