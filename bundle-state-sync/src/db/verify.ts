import "dotenv/config";
import pg from "pg";
import { logger } from "../utils/logger";
import { runMigrations } from "./migrate";
import {
  upsertBundle,
  getPendingBundles,
  markChecked,
  flagForManualReview,
  unflagBundle,
  getFlaggedBundles,
  getWatermark,
  setWatermark,
  getStats,
  getNonTerminalBundleIds,
  getBundleStatuses,
} from "../services/bundle-store";
import { createRateLimiter } from "../services/rate-limiter";
import { fetchBundles, fetchBundleById } from "../services/debridge-api";
import { ApiBundleResponse } from "../types/db";
import { BundleStatus } from "../types";

const PREFIX = "__test_verify_";
let passed = 0;
let failed = 0;

function assert(condition: boolean, description: string): void {
  if (condition) {
    passed++;
    logger.info(`  PASS: ${description}`);
  } else {
    failed++;
    logger.error(`  FAIL: ${description}`);
  }
}

function makeBundle(
  id: string,
  overrides: Partial<ApiBundleResponse> = {}
): ApiBundleResponse {
  return {
    bundleId: `${PREFIX}${id}`,
    status: BundleStatus.created,
    isAtomic: false,
    trades: [],
    intents: [],
    executedSrc: false,
    executedDst: false,
    finalizedSrc: false,
    finalizedDst: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bundles WHERE bundle_id LIKE $1`, [
    `${PREFIX}%`,
  ]);
  await pool.query(`DELETE FROM sync_state WHERE key LIKE $1`, [
    `${PREFIX}%`,
  ]);
}

async function runTests(pool: pg.Pool): Promise<void> {
  // ── Test 1: Insert bundle ──────────────────────────────────────────────
  logger.info("Test 1: Insert bundle");
  {
    const b = makeBundle("t1");
    const result = await upsertBundle(pool, b, "test");
    assert(result === "inserted", "upsertBundle returns 'inserted'");

    const row = await pool.query(
      `SELECT * FROM bundles WHERE bundle_id = $1`,
      [`${PREFIX}t1`]
    );
    assert(row.rows.length === 1, "row exists in database");
    assert(row.rows[0].status === "created", "status is 'created'");
    assert(row.rows[0].first_seen_source === "test", "first_seen_source is 'test'");
  }

  // ── Test 2: Upsert with newer updated_at ───────────────────────────────
  logger.info("Test 2: Upsert with newer updated_at");
  {
    const b = makeBundle("t1", {
      status: BundleStatus.partially_fulfilled,
      updatedAt: "2025-01-02T00:00:00.000Z",
    });
    const result = await upsertBundle(pool, b, "test");
    assert(result === "updated", "upsertBundle returns 'updated'");

    const row = await pool.query(
      `SELECT status FROM bundles WHERE bundle_id = $1`,
      [`${PREFIX}t1`]
    );
    assert(row.rows[0].status === "partially_fulfilled", "status updated to 'partially_fulfilled'");
  }

  // ── Test 3: Upsert with older updated_at ───────────────────────────────
  logger.info("Test 3: Upsert with older updated_at (should skip)");
  {
    const b = makeBundle("t1", {
      status: BundleStatus.cancelled,
      updatedAt: "2024-12-31T00:00:00.000Z",
    });
    const result = await upsertBundle(pool, b, "test");
    assert(result === "skipped", "upsertBundle returns 'skipped'");

    const row = await pool.query(
      `SELECT status FROM bundles WHERE bundle_id = $1`,
      [`${PREFIX}t1`]
    );
    assert(row.rows[0].status === "partially_fulfilled", "status unchanged (still 'partially_fulfilled')");
  }

  // ── Test 4: Bundle with cancel object ──────────────────────────────────
  logger.info("Test 4: Bundle with cancel object");
  {
    const b = makeBundle("t4", {
      cancel: {
        preImage: "0x123",
        signature: "0xabc",
        authority: "0xdef",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
    });
    const result = await upsertBundle(pool, b, "test");
    assert(result === "inserted", "inserted bundle with cancellation");

    const row = await pool.query(
      `SELECT has_cancellation FROM bundles WHERE bundle_id = $1`,
      [`${PREFIX}t4`]
    );
    assert(row.rows[0].has_cancellation === true, "has_cancellation is TRUE");
  }

  // ── Test 5: getPendingBundles filtering ────────────────────────────────
  logger.info("Test 5: getPendingBundles filtering");
  {
    // Insert a terminal bundle — should NOT appear
    const terminal = makeBundle("t5_terminal", {
      status: BundleStatus.fulfilled,
    });
    await upsertBundle(pool, terminal, "test");

    // Insert a pending bundle — should appear
    const pending = makeBundle("t5_pending", {
      status: BundleStatus.partially_fulfilled,
    });
    await upsertBundle(pool, pending, "test");

    const rows = await getPendingBundles(pool, 100);
    const ids = rows.map((r) => r.bundle_id);

    assert(
      ids.includes(`${PREFIX}t5_pending`),
      "pending bundle is in getPendingBundles"
    );
    assert(
      !ids.includes(`${PREFIX}t5_terminal`),
      "terminal bundle is NOT in getPendingBundles"
    );
    assert(
      !ids.includes(`${PREFIX}t4`),
      "cancelled (has_cancellation) bundle is NOT in getPendingBundles"
    );
  }

  // ── Test 6: Backoff logic ──────────────────────────────────────────────
  logger.info("Test 6: Backoff logic after markChecked (check_count=1 → 120s)");
  {
    const b = makeBundle("t6", { status: BundleStatus.partially_fulfilled });
    await upsertBundle(pool, b, "test");

    // markChecked increments check_count and sets last_checked_at = NOW()
    const mc = await markChecked(pool, `${PREFIX}t6`);
    assert(mc === 1, "markChecked returns 1 (row updated)");

    // Right after markChecked, check_count=1 → 120s backoff. Should NOT appear yet.
    const rows = await getPendingBundles(pool, 100);
    const ids = rows.map((r) => r.bundle_id);
    assert(
      !ids.includes(`${PREFIX}t6`),
      "just-checked bundle excluded by backoff"
    );

    // Manually set last_checked_at to 130s ago to exceed 120s backoff
    await pool.query(
      `UPDATE bundles SET last_checked_at = NOW() - INTERVAL '130 seconds'
       WHERE bundle_id = $1`,
      [`${PREFIX}t6`]
    );

    const rows2 = await getPendingBundles(pool, 100);
    const ids2 = rows2.map((r) => r.bundle_id);
    assert(
      ids2.includes(`${PREFIX}t6`),
      "bundle reappears after 120s backoff elapses"
    );
  }

  // ── Test 7: flagForManualReview ────────────────────────────────────────
  logger.info("Test 7: flagForManualReview excludes from pending");
  {
    const b = makeBundle("t7", { status: BundleStatus.partially_fulfilled });
    await upsertBundle(pool, b, "test");

    const fr = await flagForManualReview(pool, `${PREFIX}t7`);
    assert(fr === 1, "flagForManualReview returns 1");

    const rows = await getPendingBundles(pool, 100);
    const ids = rows.map((r) => r.bundle_id);
    assert(
      !ids.includes(`${PREFIX}t7`),
      "flagged bundle excluded from pending"
    );
  }

  // ── Test 8: Flag then resolve with terminal status ─────────────────────
  logger.info("Test 8: Upsert terminal status clears manual review flag");
  {
    const b = makeBundle("t8", { status: BundleStatus.partially_fulfilled });
    await upsertBundle(pool, b, "test");
    await flagForManualReview(pool, `${PREFIX}t8`);

    // Upsert with terminal status (newer timestamp)
    const resolved = makeBundle("t8", {
      status: BundleStatus.fulfilled,
      updatedAt: "2025-06-01T00:00:00.000Z",
    });
    await upsertBundle(pool, resolved, "test");

    const row = await pool.query(
      `SELECT requires_manual_review, flagged_at, status FROM bundles WHERE bundle_id = $1`,
      [`${PREFIX}t8`]
    );
    assert(
      row.rows[0].requires_manual_review === false,
      "requires_manual_review cleared after terminal upsert"
    );
    assert(
      row.rows[0].flagged_at === null,
      "flagged_at cleared after terminal upsert"
    );
    assert(row.rows[0].status === "fulfilled", "status is fulfilled");
  }

  // ── Test 9: unflagBundle ───────────────────────────────────────────────
  logger.info("Test 9: unflagBundle resets and bundle reappears in pending");
  {
    const b = makeBundle("t9", { status: BundleStatus.partially_fulfilled });
    await upsertBundle(pool, b, "test");
    await flagForManualReview(pool, `${PREFIX}t9`);

    const uf = await unflagBundle(pool, `${PREFIX}t9`);
    assert(uf === 1, "unflagBundle returns 1");

    const row = await pool.query(
      `SELECT requires_manual_review, flagged_at, check_count, last_checked_at
       FROM bundles WHERE bundle_id = $1`,
      [`${PREFIX}t9`]
    );
    assert(row.rows[0].requires_manual_review === false, "requires_manual_review is FALSE");
    assert(row.rows[0].flagged_at === null, "flagged_at is NULL");
    assert(row.rows[0].check_count === 0, "check_count reset to 0");
    assert(row.rows[0].last_checked_at === null, "last_checked_at is NULL");

    const rows = await getPendingBundles(pool, 100);
    const ids = rows.map((r) => r.bundle_id);
    assert(ids.includes(`${PREFIX}t9`), "unflagged bundle reappears in pending");
  }

  // ── Test 10: getFlaggedBundles ordering ────────────────────────────────
  logger.info("Test 10: getFlaggedBundles ordering by flagged_at DESC");
  {
    const b10a = makeBundle("t10a", { status: BundleStatus.partially_fulfilled });
    const b10b = makeBundle("t10b", { status: BundleStatus.partially_fulfilled });
    await upsertBundle(pool, b10a, "test");
    await upsertBundle(pool, b10b, "test");

    // Flag a first, then b — b has later flagged_at
    await flagForManualReview(pool, `${PREFIX}t10a`);
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 50));
    await flagForManualReview(pool, `${PREFIX}t10b`);

    const flagged = await getFlaggedBundles(pool, 100);
    const ids = flagged.map((r) => r.bundle_id);
    const idxA = ids.indexOf(`${PREFIX}t10a`);
    const idxB = ids.indexOf(`${PREFIX}t10b`);

    assert(idxA >= 0 && idxB >= 0, "both flagged bundles returned");
    assert(idxB < idxA, "b (flagged later) appears before a (DESC order)");
  }

  // ── Test 11: Write-conflict guard ──────────────────────────────────────
  logger.info("Test 11: markChecked returns 0 after bundle is resolved");
  {
    const b = makeBundle("t11", { status: BundleStatus.partially_fulfilled });
    await upsertBundle(pool, b, "test");

    // Resolve via raw SQL to simulate external update
    await pool.query(
      `UPDATE bundles SET status = 'fulfilled' WHERE bundle_id = $1`,
      [`${PREFIX}t11`]
    );

    const mc = await markChecked(pool, `${PREFIX}t11`);
    assert(mc === 0, "markChecked returns 0 for resolved bundle");
  }

  // ── Test 12: Watermark round-trip ──────────────────────────────────────
  logger.info("Test 12: Watermark round-trip");
  {
    const key = `${PREFIX}watermark`;
    const initial = await getWatermark(pool, key);
    assert(initial === null, "watermark initially null");

    await setWatermark(pool, key, "2025-01-01T00:00:00.000Z");
    const v1 = await getWatermark(pool, key);
    assert(v1 === "2025-01-01T00:00:00.000Z", "watermark value matches after set");

    await setWatermark(pool, key, "2025-06-01T00:00:00.000Z");
    const v2 = await getWatermark(pool, key);
    assert(v2 === "2025-06-01T00:00:00.000Z", "watermark value updated on upsert");
  }

  // ── Test 13: getStats ──────────────────────────────────────────────────
  logger.info("Test 13: getStats");
  {
    const stats = await getStats(pool);
    assert(stats.total > 0, "total > 0");
    assert(typeof stats.flagged === "number", "flagged is a number");
    assert(typeof stats.inFlight === "number", "inFlight is a number");
    assert(typeof stats.byStatus === "object", "byStatus is an object");

    // Count our test bundles manually
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM bundles WHERE bundle_id LIKE $1`,
      [`${PREFIX}%`]
    );
    const testCount = countResult.rows[0].cnt;
    assert(stats.total >= testCount, "total >= number of test bundles");
  }

  // ── Test 14: Rate limiter basic test ────────────────────────────────
  logger.info("Test 14: Rate limiter basic test");
  {
    const limiter = createRateLimiter({ maxRequestsPerMinute: 5, name: "test" });

    // 5 calls should resolve immediately
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
    }
    const usage = limiter.getUsage();
    assert(usage.used === 5, "5 slots used after 5 acquires");
    assert(usage.remaining === 0, "0 remaining after 5 acquires");

    // Reset should clear all
    limiter.reset();
    const usageAfterReset = limiter.getUsage();
    assert(usageAfterReset.used === 0, "0 used after reset");
    assert(usageAfterReset.remaining === 5, "5 remaining after reset");
  }

  // ── Test 15: API client type test ──────────────────────────────────
  logger.info("Test 15: API client type test");
  {
    assert(typeof fetchBundles === "function", "fetchBundles is a function");
    assert(typeof fetchBundleById === "function", "fetchBundleById is a function");

    // Compile-time type assertion: GetBundlesFilterParams has key fields
    const _typeCheck: import("../types").GetBundlesFilterParams = {
      referralCode: "test",
      createdFrom: "2025-01-01",
      createdTo: "2025-01-02",
      page: 1,
      pageSize: 10,
    };
    assert(_typeCheck.referralCode === "test", "GetBundlesFilterParams accepts referralCode");
  }

  // ── Test 16: getNonTerminalBundleIds ───────────────────────────────
  logger.info("Test 16: getNonTerminalBundleIds");
  {
    // Insert bundles with different statuses
    await upsertBundle(pool, makeBundle("t16_created", { status: BundleStatus.created }), "test");
    await upsertBundle(pool, makeBundle("t16_partial", { status: BundleStatus.partially_fulfilled }), "test");
    await upsertBundle(pool, makeBundle("t16_done", { status: BundleStatus.fulfilled }), "test");

    const ids = await getNonTerminalBundleIds(pool);
    assert(
      ids.includes(`${PREFIX}t16_created`) && ids.includes(`${PREFIX}t16_partial`),
      "non-terminal bundles returned"
    );
    assert(
      !ids.includes(`${PREFIX}t16_done`),
      "terminal bundle excluded"
    );
  }

  // ── Test 17: getBundleStatuses batch lookup ────────────────────────
  logger.info("Test 17: getBundleStatuses batch lookup");
  {
    await upsertBundle(pool, makeBundle("t17_a", { status: BundleStatus.created }), "test");
    await upsertBundle(pool, makeBundle("t17_b", { status: BundleStatus.fulfilled }), "test");
    await upsertBundle(pool, makeBundle("t17_c", { status: BundleStatus.cancelled }), "test");

    const map = await getBundleStatuses(pool, [
      `${PREFIX}t17_a`,
      `${PREFIX}t17_b`,
      `${PREFIX}t17_c`,
      `${PREFIX}t17_nonexistent`,
    ]);

    assert(map.size === 3, "map has 3 entries (nonexistent excluded)");
    assert(map.get(`${PREFIX}t17_a`) === "created", "t17_a status is created");
    assert(map.get(`${PREFIX}t17_b`) === "fulfilled", "t17_b status is fulfilled");
    assert(map.get(`${PREFIX}t17_c`) === "cancelled", "t17_c status is cancelled");
  }

  // ── Test 18: getPendingBundles with minAgeMinutes ──────────────────
  logger.info("Test 18: getPendingBundles with minAgeMinutes");
  {
    // Insert a fresh bundle (created_at = NOW)
    const fresh = makeBundle("t18_fresh", {
      status: BundleStatus.created,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await upsertBundle(pool, fresh, "test");

    // Insert an old bundle (created_at = 10 minutes ago)
    const oldDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const old = makeBundle("t18_old", {
      status: BundleStatus.created,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    await upsertBundle(pool, old, "test");

    // With minAgeMinutes=5, only old bundle should appear
    const filtered = await getPendingBundles(pool, 100, 5);
    const filteredIds = filtered.map((r) => r.bundle_id);
    assert(
      filteredIds.includes(`${PREFIX}t18_old`),
      "old bundle included with minAgeMinutes=5"
    );
    assert(
      !filteredIds.includes(`${PREFIX}t18_fresh`),
      "fresh bundle excluded with minAgeMinutes=5"
    );

    // Without minAgeMinutes, both should appear
    const all = await getPendingBundles(pool, 100);
    const allIds = all.map((r) => r.bundle_id);
    assert(
      allIds.includes(`${PREFIX}t18_old`) && allIds.includes(`${PREFIX}t18_fresh`),
      "both bundles included without minAgeMinutes"
    );
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    // Verify connection
    await pool.query("SELECT 1");
    logger.info("Connected to database.");

    // Run migrations
    await runMigrations(pool);

    // Cleanup before tests
    await cleanup(pool);

    // Run all tests
    logger.info("--- Running verification tests ---");
    await runTests(pool);

    // Cleanup after tests
    await cleanup(pool);

    logger.info("--- Verification complete ---");
    logger.info(`${passed}/${passed + failed} tests passed`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    logger.error("Verification failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
