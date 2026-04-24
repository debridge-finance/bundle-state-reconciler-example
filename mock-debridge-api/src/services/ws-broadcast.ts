import pg from "pg";
import WebSocket from "ws";
import { getSubscribers } from "./ws-registry";
import { getBundleById } from "./bundle-store";
import { buildBundleResponse } from "../templates/bundle-response";
import { logger } from "../utils/logger";

let pool: pg.Pool | null = null;

export function initBroadcast(dbPool: pg.Pool): void {
  pool = dbPool;
}

export async function broadcastBundleUpdate(bundleId: string): Promise<void> {
  const subscribers = getSubscribers(bundleId);
  if (!subscribers || subscribers.size === 0) return;

  if (!pool) {
    logger.error("[WS] Broadcast called before initBroadcast");
    return;
  }

  const row = await getBundleById(pool, bundleId);
  if (!row) {
    logger.error(`[WS] Broadcast: bundle ${bundleId} not found in DB`);
    return;
  }

  const bundleResponse = buildBundleResponse(row);
  const message = JSON.stringify({
    event: "bundle_update",
    data: { action: "bundle_update", timestamp: Date.now(), bundle: bundleResponse },
  });

  let count = 0;
  for (const ws of subscribers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      count++;
    }
  }

  logger.info(`[WS] Broadcast bundle_update for ${bundleId} to ${count} client(s)`);
}
