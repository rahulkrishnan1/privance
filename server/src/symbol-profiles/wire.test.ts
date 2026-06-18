import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { MiddlewareHandler } from "hono/types";

import { requireCsrfHeader } from "../core/middleware.js";
import { EnrichService } from "./enrich-service.js";
import { LookupService } from "./lookup-service.js";
import * as rateLimit from "./rate-limit.js";
import type { SymbolProfile } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";
import { __clearYahooAuthCache } from "./upstream-yahoo.js";
import { createFeatureRouter } from "./wire.js";

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

function postHeaders(userId = "wire-user-1"): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Id": userId,
    "X-Requested-With": "XMLHttpRequest",
  };
}

class InMemoryRepo {
  readonly store = new Map<string, SymbolProfile>();

  async getMany(opts: { tickers: string[] }): Promise<Map<string, SymbolProfile>> {
    const out = new Map<string, SymbolProfile>();
    for (const t of opts.tickers) {
      const p = this.store.get(t);
      if (p) out.set(t, p);
    }
    return out;
  }

  async upsertMany(opts: { profiles: SymbolProfile[] }): Promise<void> {
    for (const p of opts.profiles) this.store.set(p.ticker, p);
  }

  seed(profile: SymbolProfile): void {
    this.store.set(profile.ticker, profile);
  }
}

function yahooOkFetcher(
  profiles: SymbolProfile[],
): (url: string | URL | Request) => Promise<Response> {
  return async (url) => {
    const urlStr = String(url);
    // The upstream authenticates first (cookie from fc.yahoo.com, then a crumb)
    // before any quoteSummary call. Serve both so the fetch path is hermetic and
    // does not depend on a real network call having seeded the auth cache.
    if (urlStr.includes("fc.yahoo.com")) {
      return new Response("", { status: 404, headers: { "set-cookie": "A=test-cookie; Path=/" } });
    }
    if (urlStr.includes("getcrumb")) {
      return new Response("test-crumb", { status: 200 });
    }
    for (const p of profiles) {
      if (urlStr.includes(encodeURIComponent(p.ticker))) {
        const body = {
          quoteSummary: {
            result: [
              {
                assetProfile: { sector: p.sector },
                summaryDetail: { currency: p.currency },
                quoteType: { longName: p.displayName, quoteType: "EQUITY", exchange: p.exchange },
              },
            ],
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

function upstream500Fetcher(): (url: string | URL | Request) => Promise<Response> {
  return async () => new Response("error", { status: 500 });
}

function buildTestApp(
  repo: InMemoryRepo,
  fetcherForUpstream: (url: string | URL | Request) => Promise<Response>,
  cooldownMs = TEST_COOLDOWN_MS,
): { fetch: (req: Request) => Promise<Response> } {
  const lookupSvc = new LookupService({ repo: repo as never, fetcher: fetcherForUpstream });
  const enrichSvc = new EnrichService({
    repo: repo as never,
    fetcher: fetcherForUpstream,
    cooldownMs,
  });

  const { router } = createFeatureRouter(mockSessionMiddleware(), lookupSvc, enrichSvc);

  const app = new Hono();
  app.use("*", secureHeaders());
  app.use("/api/*", requireCsrfHeader);
  app.route("/api/symbol-profiles", router);

  return { fetch: async (req: Request) => app.fetch(req) };
}

beforeEach(() => {
  rateLimit.resetAll();
  __clearYahooAuthCache();
});

afterEach(() => {
  rateLimit.resetAll();
});

describe("CSRF guard", () => {
  it("POST /lookup without X-Requested-With → 403", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": "u1" },
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /refresh without X-Requested-With → 403", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": "u1" },
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("Auth guard", () => {
  it("POST /lookup without session → 401", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /refresh without session → 401", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /lookup, DB hit returns cached profile", () => {
  it("returns cached profile without calling upstream", async () => {
    const repo = new InMemoryRepo();
    repo.seed({ ticker: "AAPL", assetType: "stock", displayName: "Apple Inc." });

    let fetcherCalled = false;
    const fetcher = async (): Promise<Response> => {
      fetcherCalled = true;
      return new Response("should not be called", { status: 500 });
    };

    const server = buildTestApp(repo, fetcher);
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );

    expect(res.status).toBe(200);
    expect(fetcherCalled).toBe(false);

    const body = (await res.json()) as { profiles: SymbolProfile[]; unknown: string[] };
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]?.ticker).toBe("AAPL");
    expect(body.unknown).toEqual([]);
  });
});

describe("POST /lookup, DB miss triggers upstream fetch + insert", () => {
  it("returns fetched profile for cache miss", async () => {
    const repo = new InMemoryRepo();
    const msft: SymbolProfile = { ticker: "MSFT", assetType: "stock", displayName: "Microsoft" };

    const server = buildTestApp(repo, yahooOkFetcher([msft]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["MSFT"] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: SymbolProfile[]; unknown: string[] };
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]?.ticker).toBe("MSFT");
    expect(body.unknown).toEqual([]);
  });
});

describe("POST /lookup, unknown ticker", () => {
  it("unknown ticker goes in unknown[] array", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["NOPETICKER"] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: SymbolProfile[]; unknown: string[] };
    expect(body.profiles).toEqual([]);
    expect(body.unknown).toEqual(["NOPETICKER"]);
  });
});

describe("POST /lookup, input validation", () => {
  it("missing tickers field → 400", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("empty tickers [] → 400", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: [] }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("non-array tickers → 400", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: "AAPL" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("oversized tickers array → 400 before any upstream fetch", async () => {
    const repo = new InMemoryRepo();
    let fetcherCalled = false;
    const fetcher = async (): Promise<Response> => {
      fetcherCalled = true;
      return new Response("should not be called", { status: 500 });
    };
    const server = buildTestApp(repo, fetcher);
    const tickers = Array.from({ length: 101 }, (_, i) => `T${i}`);
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers }),
      }),
    );
    expect(res.status).toBe(400);
    expect(fetcherCalled).toBe(false);
  });

  it("malformed ticker string → 400 before any upstream fetch", async () => {
    const repo = new InMemoryRepo();
    let fetcherCalled = false;
    const fetcher = async (): Promise<Response> => {
      fetcherCalled = true;
      return new Response("should not be called", { status: 500 });
    };
    const server = buildTestApp(repo, fetcher);
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["AAPL", "../etc/passwd"] }),
      }),
    );
    expect(res.status).toBe(400);
    expect(fetcherCalled).toBe(false);
  });
});

describe("POST /lookup, upstream 5xx", () => {
  it("upstream 5xx on cache miss → ticker lands in unknown[], no 503 bubble", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, upstream500Fetcher());
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: unknown[]; unknown: string[] };
    expect(body.profiles).toEqual([]);
    expect(body.unknown).toEqual(["AAPL"]);
  });
});

describe("POST /refresh, happy path", () => {
  it("returns profile from upstream", async () => {
    const repo = new InMemoryRepo();
    const aapl: SymbolProfile = { ticker: "AAPL", assetType: "stock", displayName: "Apple Inc." };
    const server = buildTestApp(repo, yahooOkFetcher([aapl]));

    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: SymbolProfile[]; unknown: string[] };
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]?.ticker).toBe("AAPL");
    expect(body.unknown).toEqual([]);
  });
});

describe("POST /refresh, per-user rate-limit", () => {
  it("second request within cooldown → 429 with Retry-After", async () => {
    const repo = new InMemoryRepo();
    const aapl: SymbolProfile = { ticker: "AAPL", assetType: "stock" };
    const server = buildTestApp(repo, yahooOkFetcher([aapl]));

    const first = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeDefined();
  });

  it("different users have independent cooldowns", async () => {
    const repo = new InMemoryRepo();
    const aapl: SymbolProfile = { ticker: "AAPL", assetType: "stock" };
    const server = buildTestApp(repo, yahooOkFetcher([aapl]));

    await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: postHeaders("user-A"),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );

    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: postHeaders("user-B"),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("UpstreamUnavailableError maps to 503", () => {
  function appWithThrowingServices(): { fetch: (req: Request) => Promise<Response> } {
    const throwing = {
      lookup: async () => {
        throw new UpstreamUnavailableError("upstream returned non-2xx");
      },
      refresh: async () => {
        throw new UpstreamUnavailableError("upstream returned non-2xx");
      },
      msUntilNextRefresh: () => 0,
    };
    const { router } = createFeatureRouter(
      mockSessionMiddleware(),
      throwing as unknown as LookupService,
      throwing as unknown as EnrichService,
    );
    const app = new Hono();
    app.use("*", secureHeaders());
    app.use("/api/*", requireCsrfHeader);
    app.route("/api/symbol-profiles", router);
    return { fetch: async (req: Request) => app.fetch(req) };
  }

  it("POST /lookup → 503 with Retry-After header", async () => {
    const server = appWithThrowingServices();
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/lookup`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("POST /refresh → 503 with Retry-After header", async () => {
    const server = appWithThrowingServices();
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: ["AAPL"] }),
      }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
  });
});

describe("POST /refresh, input validation", () => {
  it("missing tickers → 400", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("empty tickers [] → 400", async () => {
    const repo = new InMemoryRepo();
    const server = buildTestApp(repo, yahooOkFetcher([]));
    const res = await server.fetch(
      new Request(`${BASE}/api/symbol-profiles/refresh`, {
        method: "POST",
        headers: postHeaders(),
        body: JSON.stringify({ tickers: [] }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
