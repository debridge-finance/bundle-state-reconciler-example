import pg from "pg";
import { ApiBundleResponse, Stats } from "../types/db";
import { TERMINAL_BUNDLE_STATUSES } from "../types";

// ─── upsertBundle ──────────────────────────────────────────────────────────────

export type UpsertResult = "inserted" | "updated" | "skipped";

export async function upsertBundle(
  pool: pg.Pool,
  bundle: ApiBundleResponse,
  source: string
): Promise<UpsertResult> {
  const bundleId = bundle.bundleId;
  const status = bundle.status;
  const hasCancellation = bundle.cancel != null;
  const createdAt = bundle.createdAt || null;
  const updatedAt = bundle.updatedAt || null;
  const isTerminal = TERMINAL_BUNDLE_STATUSES.includes(status);

  const sql = `
    INSERT INTO bundles (
      bundle_id, status, has_cancellation, raw_payload,
      created_at, updated_at, first_seen_source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (bundle_id) DO UPDATE SET
      status           = EXCLUDED.status,
      has_cancellation = EXCLUDED.has_cancellation,
      raw_payload      = EXCLUDED.raw_payload,
      updated_at       = EXCLUDED.updated_at,
      synced_at        = NOW(),
      check_count      = CASE
                           WHEN ${isTerminal}
                             OR bundles.status IS DISTINCT FROM EXCLUDED.status
                           THEN 0
                           ELSE bundles.check_count
                         END,
      requires_manual_review = CASE
                                 WHEN ${isTerminal} THEN FALSE
                                 ELSE bundles.requires_manual_review
                               END,
      flagged_at       = CASE
                           WHEN ${isTerminal} THEN NULL
                           ELSE bundles.flagged_at
                         END
    WHERE bundles.updated_at IS NULL
       OR bundles.updated_at < EXCLUDED.updated_at
    RETURNING (xmax = 0) AS was_inserted
  `;

  const result = await pool.query(sql, [
    bundleId,
    status,
    hasCancellation,
    JSON.stringify(bundle),
    createdAt,
    updatedAt,
    source,
  ]);

  if (result.rowCount === 0) return "skipped";
  return result.rows[0].was_inserted ? "inserted" : "updated";
}

// ─── getPendingBundles ─────────────────────────────────────────────────────────

export async function getPendingBundles(
  pool: pg.Pool,
  limit: number = 50,
  minAgeMinutes?: number
): Promise<{ bundle_id: string; raw_payload: Record<string, unknown>; check_count: number }[]> {
  const params: (number | string)[] = [];
  let paramIdx = 1;

  const ageClause = minAgeMinutes != null
    ? `AND created_at < NOW() - make_interval(mins => $${paramIdx++})`
    : "";

  const limitParam = `$${paramIdx}`;

  const sql = `
    SELECT bundle_id, raw_payload, check_count
    FROM bundles
    WHERE status NOT IN ('fulfilled', 'expired', 'cancelled', 'failed')
      AND has_cancellation = FALSE
      AND requires_manual_review = FALSE
      ${ageClause}
      AND (
        last_checked_at IS NULL
        OR last_checked_at < NOW() - (
          CASE
            WHEN check_count = 0 THEN INTERVAL '60 seconds'
            WHEN check_count = 1 THEN INTERVAL '120 seconds'
            WHEN check_count = 2 THEN INTERVAL '240 seconds'
            WHEN check_count = 3 THEN INTERVAL '480 seconds'
            ELSE INTERVAL '900 seconds'
          END
        )
      )
    ORDER BY last_checked_at NULLS FIRST, updated_at ASC
    LIMIT ${limitParam}
  `;

  if (minAgeMinutes != null) params.push(minAgeMinutes);
  params.push(limit);

  const result = await pool.query(sql, params);
  return result.rows;
}

// ─── markChecked ───────────────────────────────────────────────────────────────

export async function markChecked(
  pool: pg.Pool,
  bundleId: string
): Promise<number> {
  const sql = `
    UPDATE bundles
    SET check_count     = check_count + 1,
        last_checked_at = NOW()
    WHERE bundle_id = $1
      AND status NOT IN ('fulfilled', 'expired', 'cancelled', 'failed')
      AND has_cancellation = FALSE
      AND requires_manual_review = FALSE
  `;
  const result = await pool.query(sql, [bundleId]);
  return result.rowCount ?? 0;
}

// ─── flagForManualReview ───────────────────────────────────────────────────────

export async function flagForManualReview(
  pool: pg.Pool,
  bundleId: string
): Promise<number> {
  const sql = `
    UPDATE bundles
    SET requires_manual_review = TRUE,
        flagged_at             = NOW()
    WHERE bundle_id = $1
      AND status NOT IN ('fulfilled', 'expired', 'cancelled', 'failed')
      AND has_cancellation = FALSE
      AND requires_manual_review = FALSE
  `;
  const result = await pool.query(sql, [bundleId]);
  return result.rowCount ?? 0;
}

// ─── unflagBundle ──────────────────────────────────────────────────────────────

export async function unflagBundle(
  pool: pg.Pool,
  bundleId: string
): Promise<number> {
  const sql = `
    UPDATE bundles
    SET requires_manual_review = FALSE,
        flagged_at             = NULL,
        check_count            = 0,
        last_checked_at        = NULL
    WHERE bundle_id = $1
      AND requires_manual_review = TRUE
  `;
  const result = await pool.query(sql, [bundleId]);
  return result.rowCount ?? 0;
}

// ─── getFlaggedBundles ─────────────────────────────────────────────────────────

export async function getFlaggedBundles(
  pool: pg.Pool,
  limit: number = 50,
  offset: number = 0
): Promise<{ bundle_id: string; raw_payload: Record<string, unknown>; flagged_at: Date }[]> {
  const sql = `
    SELECT bundle_id, raw_payload, flagged_at
    FROM bundles
    WHERE requires_manual_review = TRUE
    ORDER BY flagged_at DESC
    LIMIT $1 OFFSET $2
  `;
  const result = await pool.query(sql, [limit, offset]);
  return result.rows;
}

// ─── Watermark (sync_state) ────────────────────────────────────────────────────

export async function getWatermark(
  pool: pg.Pool,
  key: string
): Promise<string | null> {
  const result = await pool.query(
    `SELECT value FROM sync_state WHERE key = $1`,
    [key]
  );
  return result.rows.length > 0 ? result.rows[0].value : null;
}

export async function setWatermark(
  pool: pg.Pool,
  key: string,
  value: string
): Promise<void> {
  await pool.query(
    `INSERT INTO sync_state (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

// ─── getStats ──────────────────────────────────────────────────────────────────

export async function getStats(pool: pg.Pool): Promise<Stats> {
  const sql = `
    SELECT
      COALESCE(status, 'unknown') AS status,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE requires_manual_review = TRUE)::int AS flagged,
      COUNT(*) FILTER (
        WHERE status NOT IN ('fulfilled', 'expired', 'cancelled', 'failed')
          AND has_cancellation = FALSE
          AND requires_manual_review = FALSE
      )::int AS in_flight
    FROM bundles
    GROUP BY status
  `;

  const result = await pool.query(sql);

  const byStatus: Record<string, number> = {};
  let flagged = 0;
  let inFlight = 0;
  let total = 0;

  for (const row of result.rows) {
    byStatus[row.status] = row.count;
    total += row.count;
    flagged += row.flagged;
    inFlight += row.in_flight;
  }

  return { byStatus, flagged, inFlight, total };
}

// ─── getNonTerminalBundleIds ────────────────────────────────────────────────

export async function getNonTerminalBundleIds(
  pool: pg.Pool
): Promise<string[]> {
  const sql = `
    SELECT bundle_id FROM bundles
    WHERE status NOT IN ('fulfilled', 'cancelled', 'expired', 'failed')
    ORDER BY created_at DESC
  `;
  const result = await pool.query(sql);
  return result.rows.map((r: { bundle_id: string }) => r.bundle_id);
}

// ─── getBundleStatuses ──────────────────────────────────────────────────────

export async function getBundleStatuses(
  pool: pg.Pool,
  bundleIds: string[]
): Promise<Map<string, string>> {
  if (bundleIds.length === 0) return new Map();
  const sql = `SELECT bundle_id, status FROM bundles WHERE bundle_id = ANY($1)`;
  const result = await pool.query(sql, [bundleIds]);
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.bundle_id, row.status);
  }
  return map;
}
