import pg from "pg";
import { Config } from "../config";
import { DebridgeApiOptions, fetchBundleById } from "../services/debridge-api";
import {
  upsertBundle,
  getPendingBundles,
  markChecked,
  flagForManualReview,
} from "../services/bundle-store";
import { createRateLimiter } from "../services/rate-limiter";
import { logger } from "../utils/logger";
import { sleep } from "../utils/sleep";

// ─── Reconcile cycle ─────────────────────────────────────────────────────────

async function reconcileCycle(
  pool: pg.Pool,
  config: Config,
  apiOptions: DebridgeApiOptions,
  limiter: ReturnType<typeof createRateLimiter>,
): Promise<void> {
  const staleBundles = await getPendingBundles(
    pool,
    500,
    config.worker3MinBundleAgeMinutes,
  );

  if (staleBundles.length === 0) {
    logger.debug("[reconciler] no stale bundles to check");
    return;
  }

  let refreshed = 0;
  let notFound = 0;
  let flagged = 0;
  let errors = 0;

  for (const bundle of staleBundles) {
    try {
      await limiter.acquire();

      const fresh = await fetchBundleById(apiOptions, bundle.bundle_id);

      if (!fresh) {
        logger.warn(
          `[reconciler] bundle ${bundle.bundle_id} not found in API`,
        );
        await markChecked(pool, bundle.bundle_id);
        notFound++;
        continue;
      }

      await upsertBundle(pool, fresh, "reconciler");
      await markChecked(pool, bundle.bundle_id);
      refreshed++;

      // Flag if we've hit the max check count
      if (bundle.check_count + 1 >= config.worker3MaxCheckCount) {
        await flagForManualReview(pool, bundle.bundle_id);
        flagged++;
        logger.warn(
          `[reconciler] bundle ${bundle.bundle_id} flagged for manual review (check_count=${bundle.check_count + 1})`,
        );
      }
    } catch (err) {
      logger.error(
        `[reconciler] error processing ${bundle.bundle_id}:`,
        err instanceof Error ? err.message : err,
      );
      errors++;
    }
  }

  logger.info(
    `[reconciler] cycle done: checked=${staleBundles.length} refreshed=${refreshed} notFound=${notFound} flagged=${flagged} errors=${errors}`,
  );
}

// ─── Worker entry point ─────────────────────────────────────────────────────

export async function startReconcilerWorker(
  pool: pg.Pool,
  config: Config,
  apiOptions: DebridgeApiOptions,
): Promise<{ stop: () => void }> {
  logger.info("[reconciler] starting...");

  let running = true;
  const limiter = createRateLimiter({
    maxRequestsPerMinute: config.rateLimitWorker3Rpm,
    name: "reconciler",
  });

  const loop = async () => {
    // Initial delay to let poller seed some data first
    await sleep(3000);

    while (running) {
      try {
        await reconcileCycle(pool, config, apiOptions, limiter);
      } catch (err) {
        logger.error(
          "[reconciler] reconcile cycle error:",
          err instanceof Error ? err.message : err,
        );
      }

      if (running) {
        await sleep(config.worker3PollIntervalMs);
      }
    }
  };

  // Start the loop (non-blocking)
  loop();

  logger.info("[reconciler] started");

  return {
    stop: () => {
      logger.info("[reconciler] stopping...");
      running = false;
      limiter.reset();
      logger.info("[reconciler] stopped");
    },
  };
}
