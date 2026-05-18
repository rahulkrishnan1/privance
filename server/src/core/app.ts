import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { requireCsrfHeader } from "./middleware.js";

export type FeatureRouter = {
  basePath: string;
  router: Hono;
};

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createApp(features: FeatureRouter[] = []): Hono {
  const app = new Hono();
  const allowedOrigins = parseAllowedOrigins();

  app.use("*", honoLogger());
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    }),
  );
  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: ["Content-Type", "X-Requested-With"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("/api/*", requireCsrfHeader);

  app.get("/health", (c) => c.json({ ok: true, service: "privance", ts: Date.now() }));

  for (const { basePath, router } of features) {
    app.route(basePath, router);
  }

  return app;
}
