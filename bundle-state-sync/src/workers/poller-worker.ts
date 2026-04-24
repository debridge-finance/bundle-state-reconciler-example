import pg from "pg";
import { Config } from "../config";
import { DebridgeApiOptions, fetchBundles } from "../services/debridge-api";
import {
  upsertBundle,
  getWatermark,
  setWatermark,
} from "../services/bundle-store";
import { createRateLimiter } from "../services/rate-limiter";
import { logger } from "../utils/logger";
import { sleep } from "../utils/sleep";

// ─── Poll cycle ──────────────────────────────────────────────────────────────

async function pollCycle(
  pool: pg.Pool,
  config: Config,
  apiOptions: DebridgeApiOptions,
  limiter: ReturnType<typeof createRateLimiter>,
): Promise<void> {
  const watermark = await getWatermark(pool, "worker2_last_synced_at");

  const now = new Date();
  const from = watermark
    ? new Date(
        new Date(watermark).getTime() -
          config.worker2OverlapBufferSeconds * 1000,
      )
    : new Date(now.getTime() - 5 * 60 * 1000); // first run: 5 min ago

  const createdFrom = from.toISOString();
  const createdTo = now.toISOString();

  let page = 1;
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalPages = 1;

  logger.info(
    `[poller] poll cycle: from=${createdFrom} to=${createdTo}`,
  );

  while (page <= totalPages) {
    await limiter.acquire();

    const response = await fetchBundles(apiOptions, {
      createdFrom,
      createdTo,
      referralCode: config.referralCode,
      page,
      pageSize: 100,
      sort: "createdAt",
    });

    totalPages = response.totalPages;

    for (const bundle of response.bundles) {
      try {
        const result = await upsertBundle(pool, bundle, "poller");
        totalProcessed++;
        if (result === "inserted") totalInserted++;
        else if (result === "updated") totalUpdated++;
        else totalSkipped++;
      } catch (err) {
        logger.error(
          `[poller] upsert failed for ${bundle.bundleId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    page++;
  }

  // Advance watermark
  await setWatermark(pool, "worker2_last_synced_at", createdTo);

  logger.info(
    `[poller] cycle done: processed=${totalProcessed} inserted=${totalInserted} updated=${totalUpdated} skipped=${totalSkipped} pages=${totalPages}`,
  );
}

// ─── Worker entry point ─────────────────────────────────────────────────────

export async function startPollerWorker(
  pool: pg.Pool,
  config: Config,
  apiOptions: DebridgeApiOptions,
): Promise<{ stop: () => void }> {
  logger.info("[poller] starting...");

  let running = true;
  const limiter = createRateLimiter({
    maxRequestsPerMinute: config.rateLimitWorker2Rpm,
    name: "poller",
  });

  const loop = async () => {
    // Small initial delay to let other workers start
    await sleep(1000);

    while (running) {
      try {
        await pollCycle(pool, config, apiOptions, limiter);
      } catch (err) {
        logger.error(
          "[poller] poll cycle error:",
          err instanceof Error ? err.message : err,
        );
      }

      if (running) {
        await sleep(config.worker2PollIntervalMs);
      }
    }
  };

  // Start the loop (non-blocking)
  loop();

  logger.info("[poller] started");

  return {
    stop: () => {
      logger.info("[poller] stopping...");
      running = false;
      limiter.reset();
      logger.info("[poller] stopped");
    },
  };
}
