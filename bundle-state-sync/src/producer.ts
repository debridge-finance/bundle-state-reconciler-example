import { loadProducerConfig, ProducerConfig } from "./config";
import { connectDb, getPool, disconnectDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { upsertBundle } from "./services/bundle-store";
import { BundleResponse, BundleStatus } from "./types";
import fs from "fs";
import path from "path";

// =============================================================================
// Types
// =============================================================================

interface SubmitResponse {
  bundleId: string;
}

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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Map target status → expected final status after the mock API's progression
 * worker has finished advancing the bundle through its state machine.
 *
 * Two-step paths:
 *   partially_fulfilled → fulfilled
 *   partially_fulfilled_expired → expired  (goes through partially_fulfilled first)
 *
 * Single-step paths:
 *   fulfilled → fulfilled
 *   cancelled → cancelled
 *   expired → expired
 *   failed → failed
 */
function expectedFinalStatus(targetStatus: string): string {
  switch (targetStatus) {
    case "partially_fulfilled":
      return "fulfilled";
    case "partially_fulfilled_expired":
      return "expired";
    default:
      return targetStatus;
  }
}

function buildSeedBundle(bundleId: string, referralCode: string): BundleResponse {
  const now = new Date().toISOString();
  return {
    bundleId,
    status: BundleStatus.created,
    isAtomic: false,
    trades: [],
    intents: [],
    executedSrc: false,
    executedDst: false,
    finalizedSrc: false,
    finalizedDst: false,
    createdAt: now,
    updatedAt: now,
    referralCode,
  };
}

/**
 * Build a round-robin queue of target statuses from the distribution config.
 * E.g. { fulfilled: 3, cancelled: 2 } → ["fulfilled","cancelled","fulfilled","cancelled","fulfilled"]
 */
function buildTargetQueue(distribution: Record<string, number>): string[] {
  const entries = Object.entries(distribution).filter(([, count]) => count > 0);
  const queue: string[] = [];
  const remaining = new Map(entries);

  while (remaining.size > 0) {
    for (const [status] of entries) {
      const left = remaining.get(status);
      if (left != null && left > 0) {
        queue.push(status);
        remaining.set(status, left - 1);
      }
      if (left != null && left <= 1) {
        remaining.delete(status);
      }
    }
  }

  return queue;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = loadProducerConfig();
  const delayMs = Math.floor(1000 / config.rps);

  console.log("=== Bundle Producer ===");
  console.log(`  Mock API:       ${config.mockApiUrl}`);
  console.log(`  Database:       ${config.databaseUrl.replace(/\/\/.*@/, "//***@")}`);
  console.log(`  Total bundles:  ${config.totalBundles}`);
  console.log(`  RPS:            ${config.rps} (${delayMs}ms delay)`);
  console.log(`  Distribution:   ${JSON.stringify(config.distribution)}`);
  console.log();

  // Connect & migrate
  await connectDb(config.databaseUrl);
  const pool = getPool(config.databaseUrl);
  await runMigrations(pool);

  const targetQueue = buildTargetQueue(config.distribution);
  const submitted: ManifestBundle[] = [];
  let failCount = 0;
  let aborted = false;
  const startedAt = new Date();
  const progressInterval = Math.max(1, Math.floor(config.totalBundles / 10));

  for (let i = 0; i < targetQueue.length; i++) {
    const targetStatus = targetQueue[i];

    try {
      // POST to mock API
      const resp = await fetch(`${config.mockApiUrl}/v1.1/gasless/bundles/submit?format=json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referralCode: config.referralCode,
          targetStatus,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${body}`);
      }

      const data = (await resp.json()) as SubmitResponse;
      const bundleId = data.bundleId;

      // Insert seed bundle into Postgres with "created" status
      const seed = buildSeedBundle(bundleId, config.referralCode);
      await upsertBundle(pool, seed, "producer");

      submitted.push({
        bundleId,
        targetStatus,
        expectedFinalStatus: expectedFinalStatus(targetStatus),
      });
    } catch (err) {
      failCount++;
      console.error(`  [FAIL] #${i + 1} (target=${targetStatus}): ${err instanceof Error ? err.message : err}`);

      // Abort if failure rate exceeds 20%
      const total = i + 1;
      if (failCount / total > 0.2 && total >= 5) {
        console.error(`\nAborting: failure rate ${((failCount / total) * 100).toFixed(1)}% exceeds 20% threshold (${failCount}/${total})`);
        aborted = true;
        break;
      }
    }

    // Progress logging
    if ((i + 1) % progressInterval === 0 || i === targetQueue.length - 1) {
      console.log(`  Progress: ${i + 1}/${targetQueue.length} submitted (${failCount} failed)`);
    }

    // Rate control
    if (i < targetQueue.length - 1) {
      await sleep(delayMs);
    }
  }

  // Build manifest
  const completedAt = new Date();
  const byTargetStatus: Record<string, number> = {};
  const expectedFinalCounts: Record<string, number> = {};

  for (const b of submitted) {
    byTargetStatus[b.targetStatus] = (byTargetStatus[b.targetStatus] || 0) + 1;
    expectedFinalCounts[b.expectedFinalStatus] = (expectedFinalCounts[b.expectedFinalStatus] || 0) + 1;
  }

  const manifest: Manifest = {
    metadata: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      mockApiUrl: config.mockApiUrl,
      databaseUrl: config.databaseUrl.replace(/\/\/.*@/, "//***@"),
    },
    stats: {
      totalSubmitted: submitted.length,
      totalFailed: failCount,
      byTargetStatus,
    },
    expectedFinalCounts,
    bundles: submitted,
  };

  // Write manifest
  const dataDir = path.join(__dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const manifestPath = path.join(dataDir, "producer-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log();
  console.log("=== Summary ===");
  console.log(`  Submitted:  ${submitted.length}`);
  console.log(`  Failed:     ${failCount}`);
  console.log(`  Duration:   ${manifest.metadata.durationMs}ms`);
  console.log(`  By target:  ${JSON.stringify(byTargetStatus)}`);
  console.log(`  Expected:   ${JSON.stringify(expectedFinalCounts)}`);
  console.log(`  Manifest:   ${manifestPath}`);

  await disconnectDb();
  process.exit(aborted ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
