import { loadConfig } from "./config";
import { connectDb, disconnectDb, getPool } from "./db/client";
import { runMigrations } from "./db/migrate";
import { startProgressionWorker } from "./services/progression-worker";
import { initBroadcast } from "./services/ws-broadcast";
import { startWsServer } from "./services/ws-server";
import { createApp } from "./server";
import { logger } from "./utils/logger";
import http from "http";

async function main() {
  const config = loadConfig();

  await connectDb(config.databaseUrl);

  const pool = getPool(config.databaseUrl);
  await runMigrations(pool);

  const app = createApp(pool);
  const server = http.createServer(app);

  const progressionInterval = startProgressionWorker(pool, config);

  initBroadcast(pool);
  const wss = startWsServer(config.wsPort);
  logger.info(`[WS] WebSocket server listening on port ${config.wsPort}`);

  server.listen(config.port, () => {
    logger.info(`Mock deBridge API listening on port ${config.port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down...`);
    clearInterval(progressionInterval);
    wss.close();
    server.close();
    await disconnectDb();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
