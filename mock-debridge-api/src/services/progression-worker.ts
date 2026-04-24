import pg from "pg";
import { Config } from "../config";
import { BundleRow, BundleStatus } from "../types";
import { getEligibleBundles, updateBundleStatus } from "./bundle-store";
import { broadcastBundleUpdate } from "./ws-broadcast";
import { logger } from "../utils/logger";

function getNextStatus(bundle: BundleRow): BundleStatus {
  const target = bundle.target_status;

  if (bundle.status === BundleStatus.Created) {
    switch (target) {
      case "fulfilled":
        return BundleStatus.Fulfilled;
      case "partially_fulfilled":
      case "partially_fulfilled_expired":
        return BundleStatus.PartiallyFulfilled;
      case "cancelled":
        return BundleStatus.Cancelled;
      case "expired":
        return BundleStatus.Expired;
      case "failed":
        return BundleStatus.Failed;
      default:
        return BundleStatus.Fulfilled;
    }
  }

  if (bundle.status === BundleStatus.PartiallyFulfilled) {
    if (target === "partially_fulfilled_expired") {
      return BundleStatus.Expired;
    }
    return BundleStatus.Fulfilled;
  }

  return BundleStatus.Fulfilled;
}

export function startProgressionWorker(
  pool: pg.Pool,
  config: Config,
): NodeJS.Timeout {
  const interval = setInterval(async () => {
    try {
      const eligible = await getEligibleBundles(pool, config.progressionDelayMs);

      for (const bundle of eligible) {
        const nextStatus = getNextStatus(bundle);

        if (nextStatus === BundleStatus.Cancelled) {
          await pool.query(
            `UPDATE bundles SET status = $1, cancel = $2, updated_at = NOW() WHERE bundle_id = $3`,
            [
              nextStatus,
              JSON.stringify({
                cancelBeneficiary: "0x0000000000000000000000000000000000000001",
                refundAmounts: ["1000000"],
              }),
              bundle.bundle_id,
            ],
          );
        } else {
          await updateBundleStatus(pool, bundle.bundle_id, nextStatus);
        }

        logger.info(
          `Bundle ${bundle.bundle_id}: ${bundle.status} → ${nextStatus}`,
        );
        await broadcastBundleUpdate(bundle.bundle_id);
      }
    } catch (err) {
      logger.error(
        "Progression worker error:",
        err instanceof Error ? err.message : err,
      );
    }
  }, config.progressionIntervalMs);

  logger.info(
    `Progression worker started (interval=${config.progressionIntervalMs}ms, delay=${config.progressionDelayMs}ms)`,
  );

  return interval;
}
