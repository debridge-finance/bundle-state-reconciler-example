import "dotenv/config";

export interface Config {
  databaseUrl: string;
  port: number;
  progressionDelayMs: number;
  progressionIntervalMs: number;
  wsPort: number;
  logLevel: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function optionalIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  }
  return parsed;
}

export function loadConfig(): Config {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    port: optionalIntEnv("PORT", 3000),
    progressionDelayMs: optionalIntEnv("PROGRESSION_DELAY_MS", 5000),
    progressionIntervalMs: optionalIntEnv("PROGRESSION_INTERVAL_MS", 1000),
    wsPort: optionalIntEnv("WS_PORT", 3001),
    logLevel: optionalEnv("LOG_LEVEL", "INFO"),
  };
}
