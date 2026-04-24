import { Request, Response } from "express";
import pg from "pg";
import { getBundlesFiltered } from "../services/bundle-store";
import { buildBundleListResponse } from "../templates/bundle-response";
import { GetBundlesFilterParams } from "../types";
import { logger } from "../utils/logger";

export function getBundlesHandler(pool: pg.Pool) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const filters: GetBundlesFilterParams = {
        referralCode: req.query.referralCode as string | undefined,
        createdFrom: req.query.createdFrom as string | undefined,
        createdTo: req.query.createdTo as string | undefined,
        updatedFrom: req.query.updatedFrom as string | undefined,
        updatedTo: req.query.updatedTo as string | undefined,
        sort: req.query.sort as string | undefined,
        page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
        pageSize: req.query.pageSize
          ? Math.min(parseInt(req.query.pageSize as string, 10), 100)
          : undefined,
      };

      const { rows, total } = await getBundlesFiltered(pool, filters);
      const page = filters.page ?? 1;
      const pageSize = Math.min(filters.pageSize ?? 10, 100);

      const response = buildBundleListResponse(rows, total, page, pageSize);
      res.json(response);
    } catch (err) {
      logger.error("Get bundles error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
