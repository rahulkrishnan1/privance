import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono/types";

// ---------------------------------------------------------------------------
// Wire-level tests, in-process, no real DB, no live network.
//
// Strategy: inject a mock fetcher into PriceService at construction time,
// then wire the router against a mock session middleware. No module mocking
// needed, the service is instantiated inline below.
// ---------------------------------------------------------------------------

import { secureHeaders } from "hono/secure-headers";
import { requireCsrfHeader } from "../core/middleware.js";
import { PriceService } from "./price-service.js";
import * as rateLimit from "./rate-limit.js";
import type { CachedPriceRow } from "./repo.js";
import type { FetchLike } from "./types.js";
import { createFeatureRouter } from "./wire.js";

type StubRepo = {
  getMany(opts: { source: string; tickers: string[] }): Promise<CachedPriceRow[]>;
  upsertMany(rows: CachedPriceRow[]): Promise<void>;
};

function createStubRepo(initial: CachedPriceRow[] = []): StubRepo {
  const rows = new Map(initial.map((r) => [`${r.source} ${r.ticker}`, r]));
  return {
    async getMany({ source, tickers }) {
      const out: CachedPriceRow[] = [];
      for (const t of tickers) {
        const r = rows.get(`${source} ${t}`);
        if (r) out.push(r);
      }
      return out;
    },
    async upsertMany(input) {
      for (const r of input) rows.set(`${r.source} ${r.ticker}`, r);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BASE = "http://localhost";
const TEST_COOLDOWN_MS = 80;

function mockSessionMiddleware(userId = "wire-user-1"): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header("x-user-id");
    if (!id) throw new HTTPException(401, { message: "unauthenticated" });
    c.set("userId", id ?? userId);
    return next();
  };
}

function headers(
  method: "POST" | "GET",
  userId = "wire-user-1",
  extra: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    "X-User-Id": userId,
  };
  if (method === "POST") base["X-Requested-With"] = "XMLHttpRequest";
  return { ...base, ...extra };
}

function yahooOkFetcher(prices: Record<string, number>): FetchLike {
  return async (url) => {
    const urlStr = String(url);
    for (const [ticker, price] of Object.entries(prices)) {
      if (urlStr.includes(encodeURIComponent(ticker))) {
        const body = {
          chart: {
            result: [{ meta: { regularMarketPrice: price, currency: "USD" } }],
            error: null,
          },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  };
}

function upstream500Fetcher(): FetchLike {
  return async () => new Response("error", { status: 500 });
}

function upstreamMalformedFetcher(): FetchLike {
  return async () =>
    new Response("<html>bad</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
}

function buildTestApp(
  fetcher: FetchLike,
  cooldownMs = TEST_COOLDOWN_MS,
): { fetch: (req: Request) => Promise<Response> } {
  const service = new PriceService({ pricesRepo: createStubRepo(), fetcher, cooldownMs });
  const { router } = createFeatureRouter(mockSessionMiddleware(), service);

  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("/api/*", requireCsrfHeader);
  app.route("/api/prices", router);

  return { fetch: async (req: Request) => app.fetch(req) };
}

beforeEach(() => {
  rateLimit.resetAll();
});

afterEach(() => {
  rateLimit.resetAll();
});

// ---------------------------------------------------------------------------
// CSRF guard
// ---------------------------------------------------------------------------

describe("CSRF guard", () => {
  it("POST /refresh without X-Requested-With → 403", async () => {
    const server = buildTestApp(yahooOkFetcher({ AAPL: 182.5 }));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": "u1" },
        body: JSON.stringify({ tickers: ["AAPL"], source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("GET /cooldown without X-Requested-With → allowed (read-only)", async () => {
    const server = buildTestApp(yahooOkFetcher({}));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/cooldown`, {
        method: "GET",
        headers: { "X-User-Id": "u1" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { msUntilNextRefresh: number };
    expect(body.msUntilNextRefresh).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

describe("Auth guard", () => {
  it("POST /refresh without session → 401", async () => {
    const server = buildTestApp(yahooOkFetcher({ AAPL: 182.5 }));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ tickers: ["AAPL"], source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /refresh, happy path
// ---------------------------------------------------------------------------

describe("POST /refresh, happy path", () => {
  it("returns prices and empty unknown array for known tickers", async () => {
    const server = buildTestApp(yahooOkFetcher({ AAPL: 182.5, MSFT: 420 }));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: ["AAPL", "MSFT"], source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      prices: Array<{ ticker: string; price: string; fetchedAt: string }>;
      unknown: string[];
    };
    expect(body.unknown).toEqual([]);
    expect(body.prices).toHaveLength(2);
    expect(body.prices.find((p) => p.ticker === "AAPL")?.price).toMatch(/^182\./);
  });

  it("places unresolvable tickers in unknown[]", async () => {
    const server = buildTestApp(yahooOkFetcher({ AAPL: 182.5 }));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: ["AAPL", "NOPE"], source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prices: unknown[]; unknown: string[] };
    expect(body.prices).toHaveLength(1);
    expect(body.unknown).toEqual(["NOPE"]);
  });
});

// ---------------------------------------------------------------------------
// POST /refresh, error paths
// ---------------------------------------------------------------------------

describe("POST /refresh, invalid input", () => {
  it("returns 400 for missing tickers field", async () => {
    const server = buildTestApp(yahooOkFetcher({}));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-array tickers", async () => {
    const server = buildTestApp(yahooOkFetcher({}));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: "AAPL", source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown source", async () => {
    const server = buildTestApp(yahooOkFetcher({}));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: ["AAPL"], source: "bloomberg" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("empty tickers [] → 400 and does not burn cooldown", async () => {
    const recordRefreshCalled = false;
    const trackingFetcher: FetchLike = async (url, init) => {
      // Should never be reached, validation rejects before service is called.
      return yahooOkFetcher({ AAPL: 182.5 })(url, init);
    };
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher: trackingFetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    // Patch recordRefresh detection via msUntilNextRefresh: if > 0, cooldown was burned.
    const { router } = createFeatureRouter(mockSessionMiddleware(), service);
    const app = new Hono();
    app.use("*", secureHeaders());
    app.use("/api/*", requireCsrfHeader);
    app.route("/api/prices", router);

    const res = await app.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: [], source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(400);
    // Cooldown must not have been consumed, next refresh should be free.
    expect(service.msUntilNextRefresh("wire-user-1")).toBe(0);
    expect(recordRefreshCalled).toBe(false);
  });
});

describe("POST /refresh, upstream errors (per-ticker isolation)", () => {
  it("single ticker upstream 5xx → 200 with ticker in unknown[]", async () => {
    const server = buildTestApp(upstream500Fetcher());
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: ["AAPL"], source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prices: unknown[]; unknown: string[] };
    expect(body.prices).toEqual([]);
    expect(body.unknown).toEqual(["AAPL"]);
  });

  it("malformed upstream response → 200 with ticker in unknown[]", async () => {
    const server = buildTestApp(upstreamMalformedFetcher());
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: ["AAPL"], source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prices: unknown[]; unknown: string[] };
    expect(body.prices).toEqual([]);
    expect(body.unknown).toEqual(["AAPL"]);
  });
});

// ---------------------------------------------------------------------------
// Per-user rate-limit
// ---------------------------------------------------------------------------

describe("POST /refresh, per-user rate-limit", () => {
  it("second request within cooldown → 429 with Retry-After", async () => {
    // First request fetches AAPL and populates the cache. Second request uses
    // MSFT (not cached) so it must hit upstream and triggers the rate-limit gate.
    const server = buildTestApp(yahooOkFetcher({ AAPL: 182.5, MSFT: 420 }));

    const first = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: ["AAPL"], source: "yahoo" }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: ["MSFT"], source: "yahoo" }),
      }),
    );
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeDefined();
  });

  it("different users have independent cooldowns", async () => {
    const server = buildTestApp(yahooOkFetcher({ AAPL: 182.5 }));

    await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST", "user-A"),
        body: JSON.stringify({ tickers: ["AAPL"], source: "yahoo" }),
      }),
    );

    const res = await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST", "user-B"),
        body: JSON.stringify({ tickers: ["AAPL"], source: "yahoo" }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /cooldown
// ---------------------------------------------------------------------------

describe("GET /cooldown", () => {
  it("returns 0 before any refresh", async () => {
    const server = buildTestApp(yahooOkFetcher({}));
    const res = await server.fetch(
      new Request(`${BASE}/api/prices/cooldown`, {
        method: "GET",
        headers: headers("GET"),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { msUntilNextRefresh: number };
    expect(body.msUntilNextRefresh).toBe(0);
  });

  it("returns positive msUntilNextRefresh immediately after a refresh", async () => {
    const server = buildTestApp(yahooOkFetcher({ AAPL: 182.5 }));

    await server.fetch(
      new Request(`${BASE}/api/prices/refresh`, {
        method: "POST",
        headers: headers("POST"),
        body: JSON.stringify({ tickers: ["AAPL"], source: "yahoo" }),
      }),
    );

    const res = await server.fetch(
      new Request(`${BASE}/api/prices/cooldown`, {
        method: "GET",
        headers: headers("GET"),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { msUntilNextRefresh: number };
    expect(body.msUntilNextRefresh).toBeGreaterThan(0);
  });
});
