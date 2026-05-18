import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono/types";

import type { FeatureRouter } from "../core/app.js";
import { PriceService } from "./price-service.js";
import { InvalidSourceError, RateLimitedError, UpstreamUnavailableError } from "./types.js";

// ---------------------------------------------------------------------------
// Error mapper, one per module, at the wire boundary.
// ---------------------------------------------------------------------------

function errorToHttp(err: unknown): never {
  if (err instanceof RateLimitedError) {
    const retryAfterSec = Math.ceil(err.msRemaining / 1000);
    throw new HTTPException(429, {
      res: new Response(JSON.stringify({ error: err.code, ms_remaining: err.msRemaining }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSec),
        },
      }),
    });
  }
  if (err instanceof UpstreamUnavailableError) {
    throw new HTTPException(503, {
      res: new Response(JSON.stringify({ error: err.code }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "30",
        },
      }),
    });
  }
  if (err instanceof InvalidSourceError) {
    throw new HTTPException(400, { message: err.code });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new HTTPException(400, { message: `missing_or_invalid_field: ${field}` });
  }
  if (value.length === 0) {
    throw new HTTPException(400, { message: `empty_array: ${field}` });
  }
  return value as string[];
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HTTPException(400, { message: `missing_field: ${field}` });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Router factory, sessionMiddleware injected for testability.
// ---------------------------------------------------------------------------

function buildRouter(sessionMiddleware: MiddlewareHandler, service: PriceService): Hono {
  const router = new Hono();
  router.use("*", sessionMiddleware);

  // POST /api/prices/refresh
  // CSRF required (state-changing, triggers upstream call + records cooldown).
  router.post("/refresh", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<Record<string, unknown>>();
    const tickers = requireStringArray(body.tickers, "tickers");
    const source = requireNonEmptyString(body.source, "source");

    // Per CLAUDE.md: catch specific errors for rate-limit side effects only, re-raise.
    // Here there are no side-effect-only catches; the error mapper handles all mapping.
    try {
      const result = await service.refresh({ userId, tickers, source });
      return c.json(result);
    } catch (err) {
      errorToHttp(err);
    }
  });

  // GET /api/prices/cooldown, read-only, no CSRF needed.
  router.get("/cooldown", (c) => {
    const userId = c.get("userId");
    const msUntilNextRefresh = service.msUntilNextRefresh(userId);
    return c.json({ msUntilNextRefresh });
  });

  return router;
}

export function createFeatureRouter(
  sessionMiddleware: MiddlewareHandler,
  service?: PriceService,
): FeatureRouter {
  return {
    basePath: "/api/prices",
    router: buildRouter(sessionMiddleware, service ?? new PriceService()),
  };
}
