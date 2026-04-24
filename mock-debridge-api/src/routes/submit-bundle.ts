import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { keccak256, toUtf8Bytes } from "ethers";
import pg from "pg";
import { insertBundle } from "../services/bundle-store";
import { logger } from "../utils/logger";

const ALLOWED_TARGET_STATUSES = [
  "fulfilled",
  "partially_fulfilled",
  "partially_fulfilled_expired",
  "cancelled",
  "expired",
  "failed",
];

export function submitBundleHandler(pool: pg.Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const bundleId = keccak256(toUtf8Bytes(uuidv4()));

      let referralCode: string | undefined;
      if (req.body?.referralCode != null) {
        referralCode = String(req.body.referralCode);
      }

      let targetStatus = "fulfilled";
      if (
        req.body?.targetStatus &&
        ALLOWED_TARGET_STATUSES.includes(req.body.targetStatus)
      ) {
        targetStatus = req.body.targetStatus;
      }

      await insertBundle(pool, bundleId, referralCode, targetStatus);

      logger.info(`Bundle submitted: ${bundleId} (targetStatus=${targetStatus})`);
      res.json({ bundleId });
    } catch (err) {
      logger.error("Submit bundle error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
