import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { requireCsrfHeader } from "./middleware.js";

export type FeatureRouter = {
  basePath: string;
  router: Hono;
};

export function createApp(features: FeatureRouter[] = []): Hono {
  const app = new Hono();

  app.use("*", honoLogger());
  app.use("*", secureHeaders());
  app.use("/api/*", requireCsrfHeader);

  app.get("/health", (c) => c.json({ ok: true, service: "privance", ts: Date.now() }));

  for (const { basePath, router } of features) {
    app.route(basePath, router);
  }

  return app;
}
