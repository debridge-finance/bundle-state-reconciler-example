import express from "express";
import pg from "pg";
import { submitBundleHandler } from "./routes/submit-bundle";
import { getBundleHandler } from "./routes/get-bundle";
import { getBundlesHandler } from "./routes/get-bundles";

export function createApp(pool: pg.Pool): express.Application {
  const app = express();

  app.use(express.json());

  // Routes
  app.post("/v1.1/gasless/bundles/submit", submitBundleHandler(pool));
  app.get("/v1/gasless/bundles/:bundleId", getBundleHandler(pool));
  app.get("/v1/gasless/bundles", getBundlesHandler(pool));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
