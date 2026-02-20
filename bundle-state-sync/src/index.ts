import { loadConfig } from "./config";
import { connectDb, disconnectDb, getPool } from "./db/client";
import { runMigrations } from "./db/migrate";
import { getStats } from "./services/bundle-store";
import { startWebSocketWorker } from "./workers/websocket-worker";
import { startPollerWorker } from "./workers/poller-worker";
import { startReconcilerWorker } from "./workers/reconciler-worker";
import { logger } from "./utils/logger";

async function main() {
  const config = loadConfig();

  await connectDb(config.databaseUrl);
  const pool = getPool(config.databaseUrl);
  await runMigrations(pool);

  const apiOptions = {
    baseUrl: config.debridgeApiUrl,
    apiKey: config.debridgeApiKey,
  };

  // Start all three workers concurrently
  const [wsWorker, pollerWorker, reconcilerWorker] = await Promise.all([
    startWebSocketWorker(pool, config),
    startPollerWorker(pool, config, apiOptions),
    startReconcilerWorker(pool, config, apiOptions),
  ]);

  // Periodic stats logging
  const statsTimer = setInterval(async () => {
    try {
      const stats = await getStats(pool);
      logger.info("Stats:", stats);
    } catch (err) {
      logger.error(
        "Stats query error:",
        err instanceof Error ? err.message : err,
      );
    }
  }, 30_000);

  logger.info("Bundle State Sync — All workers running");

  // Graceful shutdown
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}. Shutting down...`);

    clearInterval(statsTimer);

    // Stop all workers
    pollerWorker.stop();
    reconcilerWorker.stop();
    await wsWorker.stop();

    // Brief wait for in-flight operations
    await new Promise((r) => setTimeout(r, 2000));

    // Final stats
    try {
      const finalStats = await getStats(pool);
      logger.info("Final stats:", finalStats);
    } catch {
      // DB may already be closing
    }

    await disconnectDb();
    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
