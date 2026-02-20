import { logger } from "../utils/logger";

export interface RateLimiter {
  /** Waits if at capacity, then grants a slot. */
  acquire(): Promise<void>;
  /** Returns current usage stats. */
  getUsage(): { used: number; remaining: number };
  /** Clears all tracked timestamps (for testing). */
  reset(): void;
}

export interface RateLimiterOptions {
  maxRequestsPerMinute: number;
  name?: string;
}

/**
 * Creates a sliding-window rate limiter.
 *
 * Tracks timestamps of recent requests within a 60-second window.
 * When the window is full, `acquire()` waits until a slot opens.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { maxRequestsPerMinute, name = "rate-limiter" } = options;
  const WINDOW_MS = 60_000;

  /** Timestamps of recent requests within the sliding window. */
  let timestamps: number[] = [];

  /** Queue of callers waiting for a slot. */
  const waitQueue: Array<() => void> = [];

  function pruneOld(now: number): void {
    const cutoff = now - WINDOW_MS;
    // timestamps is kept sorted; shift from front
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }
  }

  function tryDrain(): void {
    const now = Date.now();
    pruneOld(now);

    while (waitQueue.length > 0 && timestamps.length < maxRequestsPerMinute) {
      timestamps.push(now);
      const resolve = waitQueue.shift()!;
      resolve();
    }

    // Schedule a drain when the oldest entry expires
    if (waitQueue.length > 0 && timestamps.length > 0) {
      const waitMs = timestamps[0] + WINDOW_MS - now + 1;
      setTimeout(tryDrain, waitMs);
    }
  }

  return {
    acquire(): Promise<void> {
      const now = Date.now();
      pruneOld(now);

      if (timestamps.length < maxRequestsPerMinute) {
        timestamps.push(now);
        return Promise.resolve();
      }

      logger.warn(`[${name}] rate limit reached (${maxRequestsPerMinute}/min), waiting for slot`);

      return new Promise<void>((resolve) => {
        waitQueue.push(resolve);
        // Schedule drain when oldest entry expires
        const waitMs = timestamps[0] + WINDOW_MS - now + 1;
        setTimeout(tryDrain, waitMs);
      });
    },

    getUsage() {
      pruneOld(Date.now());
      return {
        used: timestamps.length,
        remaining: Math.max(0, maxRequestsPerMinute - timestamps.length),
      };
    },

    reset() {
      timestamps = [];
      // Resolve any waiting callers immediately
      while (waitQueue.length > 0) {
        const resolve = waitQueue.shift()!;
        resolve();
      }
    },
  };
}
