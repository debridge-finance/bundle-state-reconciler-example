import pg from "pg";
import { logger } from "../utils/logger";

let pool: pg.Pool | null = null;

export function getPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl });

    pool.on("error", (err) => {
      logger.error("Unexpected error on idle database client", err.message);
    });
  }
  return pool;
}

export async function connectDb(databaseUrl: string): Promise<void> {
  const p = getPool(databaseUrl);
  const result = await p.query("SELECT NOW() AS server_time");
  logger.info("Database connected. Server time:", result.rows[0].server_time);
}

export async function disconnectDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("Database connection pool closed.");
  }
}
