const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

function getCurrentLevel(): number {
  const envLevel = (process.env.LOG_LEVEL || "INFO").toUpperCase() as LogLevel;
  return LOG_LEVELS[envLevel] ?? LOG_LEVELS.INFO;
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === "object" && arg !== null ? JSON.stringify(arg) : String(arg)
    )
    .join(" ");
}

function log(level: LogLevel, ...args: unknown[]): void {
  if (LOG_LEVELS[level] < getCurrentLevel()) return;

  const timestamp = new Date().toISOString();
  const message = formatArgs(args);
  const line = `[${timestamp}] [${level}] ${message}`;

  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (...args: unknown[]) => log("DEBUG", ...args),
  info: (...args: unknown[]) => log("INFO", ...args),
  warn: (...args: unknown[]) => log("WARN", ...args),
  error: (...args: unknown[]) => log("ERROR", ...args),
};
