import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";
import { logger } from "./utils/logger";
import { TERMINAL_BUNDLE_STATUSES, BundleStatus } from "./types";

// =============================================================================
// Types
// =============================================================================

interface ManifestBundle {
  bundleId: string;
  targetStatus: string;
  expectedFinalStatus: string;
}

interface Manifest {
  metadata: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    mockApiUrl: string;
    databaseUrl: string;
  };
  stats: {
    totalSubmitted: number;
    totalFailed: number;
    byTargetStatus: Record<string, number>;
  };
  expectedFinalCounts: Record<string, number>;
  bundles: ManifestBundle[];
}

interface MismatchDetail {
  bundleId: string;
  expected: string;
  actual: string | null;
  classification: "mismatch" | "in_progress" | "missing";
}

interface ComparisonResult {
  status: "pass" | "fail" | "in_progress" | "workers_not_run";
  totalChecked: number;
  matches: number;
  mismatches: number;
  missingFromDb: number;
  stillInProgress: number;
  expectedCounts: Record<string, number>;
  actualCounts: Record<string, number>;
  mismatchDetails: MismatchDetail[];
}

interface VerificationReport {
  timestamp: string;
  manifestPath: string;
  totalBundles: number;
  mockApiVsManifest: ComparisonResult;
  syncDbVsManifest: ComparisonResult;
  mockApiVsSyncDb: ComparisonResult;
  overall: "pass" | "fail" | "partial";
}

// =============================================================================
// Helpers
// =============================================================================

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

const TERMINAL_SET = new Set<string>(TERMINAL_BUNDLE_STATUSES as string[]);

function isTerminal(status: string): boolean {
  return TERMINAL_SET.has(status);
}

/**
 * Batch-fetch bundle_id → status from a database.
 * Uses batches of 500 to avoid oversized parameter arrays.
 */
async function fetchStatuses(
  pool: pg.Pool,
  bundleIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const BATCH = 500;

  for (let i = 0; i < bundleIds.length; i += BATCH) {
    const batch = bundleIds.slice(i, i + BATCH);
    const result = await pool.query(
      `SELECT bundle_id, status FROM bundles WHERE bundle_id = ANY($1)`,
      [batch],
    );
    for (const row of result.rows) {
      map.set(row.bundle_id, row.status);
    }
  }

  return map;
}

/**
 * Compare a status map against expected statuses from the manifest.
 */
function compareDbVsManifest(
  dbStatuses: Map<string, string>,
  manifest: Manifest,
  dbLabel: string,
): ComparisonResult {
  // If DB has zero bundles, this is a "workers_not_run" scenario
  if (dbStatuses.size === 0) {
    return {
      status: "workers_not_run",
      totalChecked: manifest.bundles.length,
      matches: 0,
      mismatches: 0,
      missingFromDb: manifest.bundles.length,
      stillInProgress: 0,
      expectedCounts: { ...manifest.expectedFinalCounts },
      actualCounts: {},
      mismatchDetails: manifest.bundles.map((b) => ({
        bundleId: b.bundleId,
        expected: b.expectedFinalStatus,
        actual: null,
        classification: "missing" as const,
      })),
    };
  }

  // If all bundles are still "created", workers haven't run yet
  const allCreated = [...dbStatuses.values()].every((s) => s === "created");
  if (allCreated) {
    return {
      status: "workers_not_run",
      totalChecked: manifest.bundles.length,
      matches: 0,
      mismatches: 0,
      missingFromDb: 0,
      stillInProgress: manifest.bundles.length,
      expectedCounts: { ...manifest.expectedFinalCounts },
      actualCounts: { created: dbStatuses.size },
      mismatchDetails: manifest.bundles.map((b) => ({
        bundleId: b.bundleId,
        expected: b.expectedFinalStatus,
        actual: "created",
        classification: "in_progress" as const,
      })),
    };
  }

  let matches = 0;
  let mismatches = 0;
  let missingFromDb = 0;
  let stillInProgress = 0;
  const mismatchDetails: MismatchDetail[] = [];
  const actualCounts: Record<string, number> = {};

  for (const bundle of manifest.bundles) {
    const actual = dbStatuses.get(bundle.bundleId) ?? null;

    if (actual !== null) {
      actualCounts[actual] = (actualCounts[actual] || 0) + 1;
    }

    if (actual === null) {
      missingFromDb++;
      mismatchDetails.push({
        bundleId: bundle.bundleId,
        expected: bundle.expectedFinalStatus,
        actual: null,
        classification: "missing",
      });
    } else if (actual === bundle.expectedFinalStatus) {
      matches++;
    } else if (isTerminal(actual)) {
      mismatches++;
      mismatchDetails.push({
        bundleId: bundle.bundleId,
        expected: bundle.expectedFinalStatus,
        actual,
        classification: "mismatch",
      });
    } else {
      stillInProgress++;
      mismatchDetails.push({
        bundleId: bundle.bundleId,
        expected: bundle.expectedFinalStatus,
        actual,
        classification: "in_progress",
      });
    }
  }

  let status: ComparisonResult["status"];
  if (mismatches > 0 || missingFromDb > 0) {
    status = "fail";
  } else if (stillInProgress > 0) {
    status = "in_progress";
  } else {
    status = "pass";
  }

  return {
    status,
    totalChecked: manifest.bundles.length,
    matches,
    mismatches,
    missingFromDb,
    stillInProgress,
    expectedCounts: { ...manifest.expectedFinalCounts },
    actualCounts,
    mismatchDetails,
  };
}

/**
 * Compare mock API DB statuses directly against sync DB statuses.
 */
function compareMockApiVsSyncDb(
  mockStatuses: Map<string, string>,
  syncStatuses: Map<string, string>,
  bundleIds: string[],
): ComparisonResult {
  // If sync DB has zero bundles, workers haven't run
  if (syncStatuses.size === 0) {
    return {
      status: "workers_not_run",
      totalChecked: bundleIds.length,
      matches: 0,
      mismatches: 0,
      missingFromDb: bundleIds.length,
      stillInProgress: 0,
      expectedCounts: {},
      actualCounts: {},
      mismatchDetails: bundleIds.map((id) => ({
        bundleId: id,
        expected: mockStatuses.get(id) || "unknown",
        actual: null,
        classification: "missing" as const,
      })),
    };
  }

  // If all sync bundles are still "created", workers haven't run yet
  const allCreated = [...syncStatuses.values()].every((s) => s === "created");
  if (allCreated) {
    const expectedCounts: Record<string, number> = {};
    for (const id of bundleIds) {
      const ms = mockStatuses.get(id) || "unknown";
      expectedCounts[ms] = (expectedCounts[ms] || 0) + 1;
    }
    return {
      status: "workers_not_run",
      totalChecked: bundleIds.length,
      matches: 0,
      mismatches: 0,
      missingFromDb: 0,
      stillInProgress: bundleIds.length,
      expectedCounts,
      actualCounts: { created: syncStatuses.size },
      mismatchDetails: bundleIds.map((id) => ({
        bundleId: id,
        expected: mockStatuses.get(id) || "unknown",
        actual: "created",
        classification: "in_progress" as const,
      })),
    };
  }

  let matches = 0;
  let mismatches = 0;
  let missingFromDb = 0;
  let stillInProgress = 0;
  const mismatchDetails: MismatchDetail[] = [];
  const expectedCounts: Record<string, number> = {};
  const actualCounts: Record<string, number> = {};

  for (const bundleId of bundleIds) {
    const mockStatus = mockStatuses.get(bundleId) ?? null;
    const syncStatus = syncStatuses.get(bundleId) ?? null;

    if (mockStatus !== null) {
      expectedCounts[mockStatus] = (expectedCounts[mockStatus] || 0) + 1;
    }
    if (syncStatus !== null) {
      actualCounts[syncStatus] = (actualCounts[syncStatus] || 0) + 1;
    }

    if (syncStatus === null) {
      missingFromDb++;
      mismatchDetails.push({
        bundleId,
        expected: mockStatus || "unknown",
        actual: null,
        classification: "missing",
      });
    } else if (mockStatus === syncStatus) {
      matches++;
    } else if (syncStatus && isTerminal(syncStatus)) {
      mismatches++;
      mismatchDetails.push({
        bundleId,
        expected: mockStatus || "unknown",
        actual: syncStatus,
        classification: "mismatch",
      });
    } else {
      stillInProgress++;
      mismatchDetails.push({
        bundleId,
        expected: mockStatus || "unknown",
        actual: syncStatus,
        classification: "in_progress",
      });
    }
  }

  let status: ComparisonResult["status"];
  if (mismatches > 0 || missingFromDb > 0) {
    status = "fail";
  } else if (stillInProgress > 0) {
    status = "in_progress";
  } else {
    status = "pass";
  }

  return {
    status,
    totalChecked: bundleIds.length,
    matches,
    mismatches,
    missingFromDb,
    stillInProgress,
    expectedCounts,
    actualCounts,
    mismatchDetails,
  };
}

function logComparison(label: string, result: ComparisonResult): void {
  logger.info(`-- ${label} --`);

  if (result.status === "workers_not_run") {
    logger.info(`WORKERS_NOT_RUN -- sync DB has 0 bundles, skipping comparison`);
    return;
  }

  const statusTag = result.status === "pass" ? "PASS" : result.status === "in_progress" ? "IN_PROGRESS" : "FAIL";
  const nonMatch = result.mismatches + result.missingFromDb + result.stillInProgress;

  if (result.status === "pass") {
    logger.info(`${statusTag} -- ${result.matches}/${result.totalChecked} bundles match expected final status`);
  } else {
    logger.info(`${statusTag} -- ${result.matches}/${result.totalChecked} bundles match, ${nonMatch} differ`);
  }

  // Per-status breakdown
  const allStatuses = new Set([
    ...Object.keys(result.expectedCounts),
    ...Object.keys(result.actualCounts),
  ]);
  for (const s of allStatuses) {
    const expected = result.expectedCounts[s] || 0;
    const actual = result.actualCounts[s] || 0;
    const marker = expected !== actual ? " ←" : "";
    logger.info(`   ${s}: ${actual} (expected ${expected})${marker}`);
  }

  if (result.missingFromDb > 0) {
    logger.info(`   missing from DB: ${result.missingFromDb}`);
  }
  if (result.stillInProgress > 0) {
    logger.info(`   still in progress: ${result.stillInProgress}`);
  }

  // Show up to 5 example mismatches
  const examples = result.mismatchDetails.slice(0, 5);
  if (examples.length > 0) {
    logger.info(`   examples (up to 5):`);
    for (const d of examples) {
      logger.info(`     ${d.bundleId}: expected=${d.expected} actual=${d.actual ?? "N/A"} (${d.classification})`);
    }
    if (result.mismatchDetails.length > 5) {
      logger.info(`     ... and ${result.mismatchDetails.length - 5} more (see report file)`);
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const PREFIX = "[Checker]";

  // Load manifest
  const dataDir = path.join(__dirname, "..", "data");
  const manifestPath = path.join(dataDir, "producer-manifest.json");

  if (!fs.existsSync(manifestPath)) {
    logger.error(`${PREFIX} Manifest not found: ${manifestPath}`);
    logger.error(`${PREFIX} Run the producer first: npm run producer`);
    process.exit(1);
  }

  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  logger.info(`${PREFIX} Loaded manifest: ${manifest.bundles.length} bundles`);

  // Connect to databases
  const syncDbUrl = optionalEnv("PRODUCER_DATABASE_URL",
    optionalEnv("DATABASE_URL", "postgresql://bundlesync:bundlesync@localhost:5432/bundlesync"));
  const mockApiDbUrl = optionalEnv("MOCK_API_DATABASE_URL", "postgresql://mockapi:mockapi@localhost:5433/mockapi");

  const syncPool = new pg.Pool({ connectionString: syncDbUrl });
  const mockApiPool = new pg.Pool({ connectionString: mockApiDbUrl });

  try {
    // Verify connections
    await mockApiPool.query("SELECT 1");
    const mockHost = new URL(mockApiDbUrl).host;
    logger.info(`${PREFIX} Connected to mock API DB (${mockHost})`);

    await syncPool.query("SELECT 1");
    const syncHost = new URL(syncDbUrl).host;
    logger.info(`${PREFIX} Connected to sync DB (${syncHost})`);

    logger.info("");

    // Collect all bundle IDs from manifest
    const bundleIds = manifest.bundles.map((b) => b.bundleId);

    // Batch-fetch statuses from both databases
    const mockStatuses = await fetchStatuses(mockApiPool, bundleIds);
    const syncStatuses = await fetchStatuses(syncPool, bundleIds);

    // Comparison 1: Mock API DB vs Manifest
    const mockApiVsManifest = compareDbVsManifest(mockStatuses, manifest, "Mock API DB");
    logger.info(`${PREFIX} -- Comparison 1: Mock API DB vs Manifest --`);
    logComparison("Comparison 1: Mock API DB vs Manifest", mockApiVsManifest);
    logger.info("");

    // Comparison 2: Sync DB vs Manifest
    const syncDbVsManifest = compareDbVsManifest(syncStatuses, manifest, "Sync DB");
    logger.info(`${PREFIX} -- Comparison 2: Sync DB vs Manifest --`);
    logComparison("Comparison 2: Sync DB vs Manifest", syncDbVsManifest);
    logger.info("");

    // Comparison 3: Mock API DB vs Sync DB
    const mockApiVsSyncDb = compareMockApiVsSyncDb(mockStatuses, syncStatuses, bundleIds);
    logger.info(`${PREFIX} -- Comparison 3: Mock API DB vs Sync DB --`);
    logComparison("Comparison 3: Mock API DB vs Sync DB", mockApiVsSyncDb);
    logger.info("");

    // Determine overall status
    const statuses = [mockApiVsManifest.status, syncDbVsManifest.status, mockApiVsSyncDb.status];
    let overall: VerificationReport["overall"];
    if (statuses.every((s) => s === "pass")) {
      overall = "pass";
    } else if (statuses.some((s) => s === "fail")) {
      overall = "fail";
    } else {
      overall = "partial";
    }

    // Build and write report
    const report: VerificationReport = {
      timestamp: new Date().toISOString(),
      manifestPath,
      totalBundles: manifest.bundles.length,
      mockApiVsManifest,
      syncDbVsManifest,
      mockApiVsSyncDb,
      overall,
    };

    fs.mkdirSync(dataDir, { recursive: true });
    const reportPath = path.join(dataDir, "verification-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    logger.info(`${PREFIX} -- Overall: ${overall.toUpperCase()} --`);
    logger.info(`${PREFIX} Report written to ${reportPath}`);

    process.exit(overall === "fail" ? 1 : 0);
  } catch (err) {
    logger.error(`${PREFIX} Fatal error:`, err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await syncPool.end();
    await mockApiPool.end();
  }
}

main();
