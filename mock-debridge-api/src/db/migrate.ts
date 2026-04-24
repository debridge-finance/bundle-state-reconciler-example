import fs from "fs";
import path from "path";
import pg from "pg";
import { logger } from "../utils/logger";

const MIGRATIONS_TABLE = "_migrations";

async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool: pg.Pool): Promise<Set<string>> {
  const result = await pool.query(`SELECT name FROM ${MIGRATIONS_TABLE}`);
  return new Set(result.rows.map((r: { name: string }) => r.name));
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await ensureMigrationsTable(pool);
  const applied = await getAppliedMigrations(pool);

  // When running via tsx: __dirname = .../src/db → migrations are in ./migrations
  // When running compiled: __dirname = .../dist/db → migrations are in ../../src/db/migrations
  let migrationsDir = path.join(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) {
    migrationsDir = path.resolve(__dirname, "..", "..", "src", "db", "migrations");
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let newCount = 0;

  for (const file of files) {
    if (applied.has(file)) {
      logger.debug(`Migration already applied: ${file}`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf-8");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`,
        [file]
      );
      await client.query("COMMIT");
      logger.info(`Migration applied: ${file}`);
      newCount++;
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error(`Migration failed: ${file}`, err instanceof Error ? err.message : err);
      throw err;
    } finally {
      client.release();
    }
  }

  if (newCount === 0) {
    logger.info("All migrations already applied.");
  } else {
    logger.info(`Applied ${newCount} migration(s).`);
  }
}

// Standalone entry point: npm run migrate
if (require.main === module) {
  require("dotenv/config");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  runMigrations(pool)
    .then(() => {
      logger.info("Migration runner complete.");
      return pool.end();
    })
    .catch((err) => {
      logger.error("Migration runner failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
