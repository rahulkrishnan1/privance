import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono/types";
import type { FeatureRouter } from "../core/app.js";
import { db } from "../core/db.js";
import { LookupService } from "./lookup-service.js";
import { SymbolProfileRepo } from "./repo.js";
import { UpstreamUnavailableError } from "./types.js";

function errorToHttp(err: unknown): never {
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

// A real portfolio has at most a few dozen distinct tickers; the cap stops an
// authenticated client turning one request into thousands of outbound upstream
// fetches (egress amplification / provider ban).
const MAX_TICKERS = 100;
// Mirror the client ticker regex (apps/web .../holdings/types.ts): alphanumerics
// plus dot and dash (BRK.B, BRK-B). The server is the trust boundary, so it
// re-validates rather than trusting the client; keep the two in sync.
const TICKER_RE = /^[A-Za-z0-9.-]{1,15}$/;

function requireTickers(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new HTTPException(400, { message: "missing_or_invalid_field: tickers" });
  }
  if (value.length === 0) {
    throw new HTTPException(400, { message: "empty_array: tickers" });
  }
  if (value.length > MAX_TICKERS) {
    throw new HTTPException(400, { message: `too_many_tickers: max ${MAX_TICKERS}` });
  }
  for (const t of value as string[]) {
    if (!TICKER_RE.test(t)) {
      throw new HTTPException(400, { message: "invalid_ticker_format" });
    }
  }
  return value as string[];
}

function buildRouter(sessionMiddleware: MiddlewareHandler, lookupService: LookupService): Hono {
  const router = new Hono();
  router.use("*", sessionMiddleware);

  router.post("/lookup", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const tickers = requireTickers(body.tickers);

    try {
      const result = await lookupService.lookup({ tickers });
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
): FeatureRouter {
  const repo = new SymbolProfileRepo(db);
  return {
    basePath: "/api/symbol-profiles",
    router: buildRouter(sessionMiddleware, lookupService ?? new LookupService({ repo })),
  };
}
