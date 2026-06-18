import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono/types";

import type { FeatureRouter } from "../core/app.js";
import { db } from "../core/db.js";
import { PriceService } from "./price-service.js";
import { PricesRepo } from "./repo.js";
import { InvalidSourceError, RateLimitedError, UpstreamUnavailableError } from "./types.js";

function errorToHttp(err: unknown): Response {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof RateLimitedError) {
    const retryAfterSec = Math.ceil(err.msRemaining / 1000);
    return new Response(JSON.stringify({ error: err.code, ms_remaining: err.msRemaining }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) },
    });
  }
  if (err instanceof UpstreamUnavailableError) {
    return new Response(JSON.stringify({ error: err.code }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": "30" },
    });
  }
  if (err instanceof InvalidSourceError) {
    return new Response(err.code, { status: 400 });
  }
  throw err;
}

// A real portfolio has at most a few dozen distinct tickers. Capping at the wire
// boundary stops an authenticated client turning one request into hundreds of
// outbound upstream fetches (one Yahoo call per ticker), which would burn the
// shared free-tier quota and risk a provider ban.
const MAX_TICKERS = 100;

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new HTTPException(400, { message: `missing_or_invalid_field: ${field}` });
  }
  if (value.length === 0) {
    throw new HTTPException(400, { message: `empty_array: ${field}` });
  }
  if (value.length > MAX_TICKERS) {
    throw new HTTPException(400, { message: `too_many_tickers: max ${MAX_TICKERS}` });
  }
  return value as string[];
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  return value;
}

function buildRouter(sessionMiddleware: MiddlewareHandler, service: PriceService): Hono {
  const router = new Hono();
  router.onError((err) => errorToHttp(err));
  router.use("*", sessionMiddleware);

  router.post("/refresh", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<Record<string, unknown>>();
    const tickers = requireStringArray(body.tickers, "tickers");
    const source = requireNonEmptyString(body.source, "source");

    const result = await service.refresh({ userId, tickers, source });
    return c.json(result);
  });

  router.get("/cooldown", (c) => {
    const userId = c.get("userId");
    const msUntilNextRefresh = service.msUntilNextRefresh(userId);
    return c.json({ msUntilNextRefresh });
  });

  return router;
}

function makeService(): PriceService {
  return new PriceService({ pricesRepo: new PricesRepo(db) });
}

export function createFeatureRouter(
  sessionMiddleware: MiddlewareHandler,
  service?: PriceService,
): FeatureRouter {
  return {
    basePath: "/api/prices",
    router: buildRouter(sessionMiddleware, service ?? makeService()),
  };
}
