import pg from "pg";
import { BundleRow, BundleStatus, GetBundlesFilterParams } from "../types";

export async function insertBundle(
  pool: pg.Pool,
  bundleId: string,
  referralCode?: string,
  targetStatus: string = "fulfilled",
): Promise<BundleRow> {
  const result = await pool.query(
    `INSERT INTO bundles (bundle_id, status, target_status, referral_code)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [bundleId, BundleStatus.Created, targetStatus, referralCode ?? null],
  );
  return result.rows[0] as BundleRow;
}

export async function getBundleById(
  pool: pg.Pool,
  bundleId: string,
): Promise<BundleRow | null> {
  const result = await pool.query(
    `SELECT * FROM bundles WHERE bundle_id = $1`,
    [bundleId],
  );
  return (result.rows[0] as BundleRow) ?? null;
}

export async function getBundlesFiltered(
  pool: pg.Pool,
  filters: GetBundlesFilterParams,
): Promise<{ rows: BundleRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (filters.referralCode) {
    conditions.push(`referral_code = $${paramIdx++}`);
    params.push(filters.referralCode);
  }
  if (filters.createdFrom) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(filters.createdFrom);
  }
  if (filters.createdTo) {
    conditions.push(`created_at <= $${paramIdx++}`);
    params.push(filters.createdTo);
  }
  if (filters.updatedFrom) {
    conditions.push(`updated_at >= $${paramIdx++}`);
    params.push(filters.updatedFrom);
  }
  if (filters.updatedTo) {
    conditions.push(`updated_at <= $${paramIdx++}`);
    params.push(filters.updatedTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Sort
  const allowedSorts: Record<string, string> = {
    createdAt: "created_at",
    "-createdAt": "created_at DESC",
    updatedAt: "updated_at",
    "-updatedAt": "updated_at DESC",
  };
  const orderBy = allowedSorts[filters.sort ?? "-createdAt"] ?? "created_at DESC";

  // Pagination
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 10, 100);
  const offset = (page - 1) * pageSize;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM bundles ${whereClause}`,
    params,
  );
  const total = countResult.rows[0].total as number;

  const dataResult = await pool.query(
    `SELECT * FROM bundles ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, pageSize, offset],
  );

  return { rows: dataResult.rows as BundleRow[], total };
}

export async function getEligibleBundles(
  pool: pg.Pool,
  delayMs: number,
): Promise<BundleRow[]> {
  const result = await pool.query(
    `SELECT * FROM bundles
     WHERE status IN ($1, $2)
       AND updated_at < NOW() - INTERVAL '1 millisecond' * $3`,
    [BundleStatus.Created, BundleStatus.PartiallyFulfilled, delayMs],
  );
  return result.rows as BundleRow[];
}

export async function updateBundleStatus(
  pool: pg.Pool,
  bundleId: string,
  newStatus: BundleStatus,
): Promise<void> {
  await pool.query(
    `UPDATE bundles SET status = $1, updated_at = NOW() WHERE bundle_id = $2`,
    [newStatus, bundleId],
  );
}
