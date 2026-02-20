import { Request, Response } from "express";
import pg from "pg";
import { getBundleById } from "../services/bundle-store";
import { buildBundleResponse } from "../templates/bundle-response";
import { logger } from "../utils/logger";

export function getBundleHandler(pool: pg.Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const { bundleId } = req.params;
      const row = await getBundleById(pool, bundleId);

      if (!row) {
        res.status(404).json({ error: "Bundle not found" });
        return;
      }

      const response = buildBundleResponse(row);
      res.json(response);
    } catch (err) {
      logger.error("Get bundle error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
