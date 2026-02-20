import "dotenv/config";

export interface Config {
  databaseUrl: string;
  mockApiDatabaseUrl: string;
  debridgeApiUrl: string;
  debridgeWsUrl: string;
  debridgeApiKey: string;
  referralCode: string;
  worker2PollIntervalMs: number;
  worker3PollIntervalMs: number;
  worker2OverlapBufferSeconds: number;
  worker3MaxCheckCount: number;
  worker3MinBundleAgeMinutes: number;
  rateLimitTotalRpm: number;
  rateLimitWorker2Rpm: number;
  rateLimitWorker3Rpm: number;
  wsMaxSubsPerConnection: number;
  wsReconnectBaseMs: number;
  wsReconnectMaxMs: number;
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
    mockApiDatabaseUrl: optionalEnv("MOCK_API_DATABASE_URL", "postgresql://mockapi:mockapi@localhost:5433/mockapi"),
    debridgeApiUrl: optionalEnv("DEBRIDGE_API_URL", "https://api-gaslessb2b.debridge.finance"),
    debridgeWsUrl: optionalEnv("DEBRIDGE_WS_URL", "wss://api-gaslessb2b.debridge.finance/ws"),
    debridgeApiKey: requireEnv("DEBRIDGE_API_KEY"),
    referralCode: requireEnv("REFERRAL_CODE"),
    worker2PollIntervalMs: optionalIntEnv("WORKER2_POLL_INTERVAL_MS", 15000),
    worker3PollIntervalMs: optionalIntEnv("WORKER3_POLL_INTERVAL_MS", 60000),
    worker2OverlapBufferSeconds: optionalIntEnv("WORKER2_OVERLAP_BUFFER_SECONDS", 10),
    worker3MaxCheckCount: optionalIntEnv("WORKER3_MAX_CHECK_COUNT", 15),
    worker3MinBundleAgeMinutes: optionalIntEnv("WORKER3_MIN_BUNDLE_AGE_MINUTES", 5),
    rateLimitTotalRpm: optionalIntEnv("RATE_LIMIT_TOTAL_RPM", 300),
    rateLimitWorker2Rpm: optionalIntEnv("RATE_LIMIT_WORKER2_RPM", 200),
    rateLimitWorker3Rpm: optionalIntEnv("RATE_LIMIT_WORKER3_RPM", 100),
    wsMaxSubsPerConnection: optionalIntEnv("WS_MAX_SUBS_PER_CONNECTION", 100),
    wsReconnectBaseMs: optionalIntEnv("WS_RECONNECT_BASE_MS", 500),
    wsReconnectMaxMs: optionalIntEnv("WS_RECONNECT_MAX_MS", 30000),
    logLevel: optionalEnv("LOG_LEVEL", "INFO"),
  };
}

// =============================================================================
// Producer config — used by src/producer.ts (test data seeder)
// =============================================================================

export interface ProducerConfig {
  databaseUrl: string;
  mockApiUrl: string;
  referralCode: string;
  totalBundles: number;
  rps: number;
  distribution: Record<string, number>;
}

const DEFAULT_DISTRIBUTION: Record<string, number> = {
  fulfilled: 50,
  partially_fulfilled: 15,
  partially_fulfilled_expired: 5,
  cancelled: 10,
  expired: 10,
  failed: 10,
};

function parseDistribution(totalBundles: number): Record<string, number> {
  const raw: Record<string, number> = {};
  const envVal = process.env.PRODUCER_DISTRIBUTION;

  if (envVal) {
    // Format: "fulfilled:50,cancelled:10,expired:10,..."
    for (const pair of envVal.split(",")) {
      const [status, countStr] = pair.trim().split(":");
      if (status && countStr) {
        raw[status.trim()] = parseInt(countStr.trim(), 10);
      }
    }
  }

  const src = Object.keys(raw).length > 0 ? raw : DEFAULT_DISTRIBUTION;
  const rawSum = Object.values(src).reduce((a, b) => a + b, 0);

  if (rawSum === totalBundles) return { ...src };

  // Scale proportionally, remainder goes to fulfilled
  const scaled: Record<string, number> = {};
  let assigned = 0;
  for (const [status, count] of Object.entries(src)) {
    if (status === "fulfilled") continue;
    scaled[status] = Math.round((count / rawSum) * totalBundles);
    assigned += scaled[status];
  }
  scaled["fulfilled"] = totalBundles - assigned;

  return scaled;
}

export function loadProducerConfig(): ProducerConfig {
  return {
    databaseUrl: optionalEnv("PRODUCER_DATABASE_URL",
      optionalEnv("DATABASE_URL", "postgresql://bundlesync:bundlesync@localhost:5432/bundlesync")),
    mockApiUrl: optionalEnv("MOCK_API_URL", "http://localhost:3000"),
    referralCode: optionalEnv("REFERRAL_CODE", "test-producer"),
    totalBundles: optionalIntEnv("PRODUCER_TOTAL_BUNDLES", 100),
    rps: optionalIntEnv("PRODUCER_RPS", 10),
    distribution: parseDistribution(optionalIntEnv("PRODUCER_TOTAL_BUNDLES", 100)),
  };
}
