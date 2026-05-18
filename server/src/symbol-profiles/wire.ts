import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono/types";
import type { FeatureRouter } from "../core/app.js";
import { db } from "../core/db.js";
import { EnrichService } from "./enrich-service.js";
import { LookupService } from "./lookup-service.js";
import { SymbolProfileRepo } from "./repo.js";
import { RateLimitedError, UpstreamUnavailableError } from "./types.js";

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

// ---------------------------------------------------------------------------
// Router factory, sessionMiddleware injected for testability.
// ---------------------------------------------------------------------------

function buildRouter(
  sessionMiddleware: MiddlewareHandler,
  lookupService: LookupService,
  enrichService: EnrichService,
): Hono {
  const router = new Hono();
  router.use("*", sessionMiddleware);

  // POST /api/symbol-profiles/lookup
  // CSRF required, triggers upstream fetch + DB write on cache miss.
  router.post("/lookup", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const tickers = requireStringArray(body.tickers, "tickers");

    try {
      const result = await lookupService.lookup({ tickers });
      return c.json(result);
    } catch (err) {
      errorToHttp(err);
    }
  });

  // POST /api/symbol-profiles/refresh
  // CSRF required, force-refresh from upstream, subject to per-user cooldown.
  router.post("/refresh", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<Record<string, unknown>>();
    const tickers = requireStringArray(body.tickers, "tickers");

    try {
      const result = await enrichService.refresh({ userId, tickers });
      return c.json(result);
    } catch (err) {
      errorToHttp(err);
    }
  });

  return router;
}

export function createFeatureRouter(
  sessionMiddleware: MiddlewareHandler,
  lookupService?: LookupService,
  enrichService?: EnrichService,
): FeatureRouter {
  const repo = new SymbolProfileRepo(db);
  return {
    basePath: "/api/symbol-profiles",
    router: buildRouter(
      sessionMiddleware,
      lookupService ?? new LookupService({ repo }),
      enrichService ?? new EnrichService({ repo }),
    ),
  };
}
