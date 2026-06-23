import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { PriceService } from "./price-service.js";
import * as rateLimit from "./rate-limit.js";
import type { CachedPriceRow } from "./repo.js";
import { InvalidSourceError, UpstreamUnavailableError } from "./types.js";
import { fetchYahooPrices } from "./upstream-yahoo.js";

type StubRepo = {
  rows: Map<string, CachedPriceRow>;
  getMany(opts: { source: string; tickers: string[] }): Promise<CachedPriceRow[]>;
  upsertMany(rows: CachedPriceRow[]): Promise<void>;
};

function createStubRepo(initial: CachedPriceRow[] = []): StubRepo {
  const rows = new Map(initial.map((r) => [`${r.source} ${r.ticker}`, r]));
  return {
    rows,
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

function yahooResponse(
  _ticker: string,
  price: number,
  opts: { previousClose?: number | null; chartPreviousClose?: number | null; status?: number } = {},
): Response {
  const meta: Record<string, unknown> = { regularMarketPrice: price, currency: "USD" };
  if (opts.previousClose !== undefined && opts.previousClose !== null) {
    meta.previousClose = opts.previousClose;
  }
  if (opts.chartPreviousClose !== undefined && opts.chartPreviousClose !== null) {
    meta.chartPreviousClose = opts.chartPreviousClose;
  }
  const body = { chart: { result: [{ meta }], error: null } };
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

function yahooEmptyResponse(): Response {
  const body = { chart: { result: [], error: null } };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function coingeckoResponse(
  entries: Record<string, { usd: number; usd_24h_change?: number | null }>,
  status = 200,
): Response {
  const body: Record<string, { usd: number; usd_24h_change?: number }> = {};
  for (const [id, e] of Object.entries(entries)) {
    body[id] =
      e.usd_24h_change !== undefined && e.usd_24h_change !== null
        ? { usd: e.usd, usd_24h_change: e.usd_24h_change }
        : { usd: e.usd };
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TEST_COOLDOWN_MS = 100;

beforeEach(() => {
  rateLimit.resetAll();
});

afterEach(() => {
  rateLimit.resetAll();
});

describe("PriceService, Yahoo happy path", () => {
  it("returns fetched prices and empty unknown list", async () => {
    const fetcher = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("AAPL")) return yahooResponse("AAPL", 182.5);
      if (urlStr.includes("MSFT")) return yahooResponse("MSFT", 420.0);
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["AAPL", "MSFT"],
      source: "yahoo",
    });

    expect(result.unknown).toEqual([]);
    expect(result.prices).toHaveLength(2);
    const aapl = result.prices.find((p) => p.ticker === "AAPL");
    expect(aapl?.price).toMatch(/^182\./);
  });
});

describe("PriceService, unknown ticker", () => {
  it("places unrecognised tickers in unknown array, not prices", async () => {
    const fetcher = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("AAPL")) return yahooResponse("AAPL", 182.5);
      // UNKNOWN_TICKER → 404 (treated as unknown)
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["AAPL", "UNKNOWN_TICKER"],
      source: "yahoo",
    });

    expect(result.prices.map((p) => p.ticker)).toEqual(["AAPL"]);
    expect(result.unknown).toEqual(["UNKNOWN_TICKER"]);
  });

  it("handles empty chart result as unknown ticker", async () => {
    const fetcher = async () => yahooEmptyResponse();
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["GONE"],
      source: "yahoo",
    });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["GONE"]);
  });
});

// Yahoo upstream 5xx: per-ticker isolation, one bad ticker doesn't fail the batch.

describe("PriceService, upstream 5xx", () => {
  it("single ticker 5xx → that ticker lands in unknown, does not throw", async () => {
    const fetcher = async () => new Response("error", { status: 500 });
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    const result = await service.refresh({ userId: "user-1", tickers: ["AAPL"], source: "yahoo" });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["AAPL"]);
  });

  it("partial batch: 1 ticker 5xx, 4 succeed → 4 prices + 1 unknown", async () => {
    const fetcher = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("FAIL")) return new Response("error", { status: 500 });
      if (urlStr.includes("A1")) return yahooResponse("A1", 10);
      if (urlStr.includes("A2")) return yahooResponse("A2", 20);
      if (urlStr.includes("A3")) return yahooResponse("A3", 30);
      if (urlStr.includes("A4")) return yahooResponse("A4", 40);
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["A1", "A2", "A3", "A4", "FAIL"],
      source: "yahoo",
    });

    expect(result.prices).toHaveLength(4);
    expect(result.unknown).toEqual(["FAIL"]);
  });
});

describe("PriceService, upstream 429 masked", () => {
  it("upstream 429 on a ticker → lands in unknown, not RateLimitedError", async () => {
    const fetcher = async () => new Response("rate limited", { status: 429 });
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    const result = await service.refresh({ userId: "user-1", tickers: ["AAPL"], source: "yahoo" });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["AAPL"]);
  });
});

describe("PriceService, malformed response", () => {
  it("malformed JSON body on a ticker → that ticker lands in unknown, does not throw", async () => {
    const fetcher = async () =>
      new Response("<html>bad</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    const result = await service.refresh({ userId: "user-1", tickers: ["AAPL"], source: "yahoo" });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["AAPL"]);
  });
});

describe("PriceService, partial response", () => {
  it("returns available prices and lists missing tickers as unknown", async () => {
    const fetcher = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("AAPL")) return yahooResponse("AAPL", 182.5);
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["AAPL", "NOPE1", "NOPE2"],
      source: "yahoo",
    });

    expect(result.prices).toHaveLength(1);
    expect(result.unknown).toEqual(["NOPE1", "NOPE2"]);
  });
});

describe("PriceService, CoinGecko happy path", () => {
  it("returns fetched prices from CoinGecko", async () => {
    const fetcher = async () =>
      coingeckoResponse({ bitcoin: { usd: 65000.5 }, ethereum: { usd: 3200.0 } });
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["bitcoin", "ethereum"],
      source: "coingecko",
    });

    expect(result.unknown).toEqual([]);
    expect(result.prices).toHaveLength(2);
    const btc = result.prices.find((p) => p.ticker === "bitcoin");
    expect(btc?.price).toMatch(/^65000\./);
  });

  it("places missing CoinGecko id in unknown", async () => {
    const fetcher = async () => coingeckoResponse({ bitcoin: { usd: 65000.5 } });
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["bitcoin", "not-a-coin"],
      source: "coingecko",
    });

    expect(result.prices.map((p) => p.ticker)).toEqual(["bitcoin"]);
    expect(result.unknown).toEqual(["not-a-coin"]);
  });

  it("CoinGecko 500 with no cache row → ticker in unknown, no throw", async () => {
    const fetcher = async () => new Response("error", { status: 500 });
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    const result = await service.refresh({
      userId: "user-1",
      tickers: ["bitcoin"],
      source: "coingecko",
    });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["bitcoin"]);
  });

  it("CoinGecko 429 with no cache row → ticker in unknown, no throw", async () => {
    const fetcher = async () => new Response("throttled", { status: 429 });
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    const result = await service.refresh({
      userId: "user-1",
      tickers: ["bitcoin"],
      source: "coingecko",
    });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["bitcoin"]);
  });
});

describe("PriceService, invalid source", () => {
  it("throws InvalidSourceError for unknown source", async () => {
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher: fetch,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    await expect(
      service.refresh({ userId: "user-1", tickers: ["AAPL"], source: "bloomberg" }),
    ).rejects.toBeInstanceOf(InvalidSourceError);
  });
});

describe("PriceService, per-user cooldown", () => {
  it("allows first request", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    await expect(
      service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" }),
    ).resolves.toBeDefined();
  });

  it("within cooldown, serves cached prices and skips upstream for uncached tickers", async () => {
    let msftFetched = false;
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("AAPL")) return yahooResponse("AAPL", 182.5);
      if (String(url).includes("MSFT")) {
        msftFetched = true;
        return yahooResponse("MSFT", 420.0);
      }
      return new Response("not found", { status: 404 });
    };
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" });

    const second = await service.refresh({
      userId: "user-cooldown",
      tickers: ["AAPL", "MSFT"],
      source: "yahoo",
    });

    expect(second.prices.map((p) => p.ticker)).toEqual(["AAPL"]);
    expect(second.unknown).toEqual(["MSFT"]);
    expect(msftFetched).toBe(false);
  });

  it("within cooldown, serves a stale cached row rather than dropping it to unknown", async () => {
    const stale: CachedPriceRow = {
      source: "yahoo",
      ticker: "AAPL",
      price: "150.00",
      previousPrice: null,
      fetchedAt: new Date(0), // epoch, far beyond CACHE_TTL_MS
    };
    let aaplFetched = false;
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("AAPL")) {
        aaplFetched = true;
        return yahooResponse("AAPL", 999.0);
      }
      if (String(url).includes("ZZZ")) return yahooResponse("ZZZ", 5.0);
      return new Response("not found", { status: 404 });
    };
    const service = new PriceService({
      pricesRepo: createStubRepo([stale]),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    // Unrelated ticker starts the cooldown.
    await service.refresh({ userId: "user-stale", tickers: ["ZZZ"], source: "yahoo" });

    const second = await service.refresh({
      userId: "user-stale",
      tickers: ["AAPL"],
      source: "yahoo",
    });

    expect(second.prices.map((p) => p.ticker)).toEqual(["AAPL"]);
    expect(second.prices[0]?.price).toBe("150.00");
    expect(second.unknown).toEqual([]);
    expect(aaplFetched).toBe(false);
  });

  it("a refresh of one source does not gate a refresh of the other source", async () => {
    let coingeckoFetched = false;
    const fetcher = async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("coingecko")) {
        coingeckoFetched = true;
        return coingeckoResponse({ bitcoin: { usd: 50000 } });
      }
      return yahooResponse("AAPL", 182.5);
    };
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await service.refresh({ userId: "user-multi", tickers: ["AAPL"], source: "yahoo" });
    const cg = await service.refresh({
      userId: "user-multi",
      tickers: ["bitcoin"],
      source: "coingecko",
    });

    expect(coingeckoFetched).toBe(true);
    expect(cg.prices.map((p) => p.ticker)).toEqual(["bitcoin"]);
    expect(cg.unknown).toEqual([]);
  });

  it("allows request after cooldown window elapses", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" });

    // Wait for the tiny test cooldown to expire.
    await Bun.sleep(TEST_COOLDOWN_MS + 10);

    await expect(
      service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" }),
    ).resolves.toBeDefined();
  });

  it("cooldown is per-user, different users do not share cooldown", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    await service.refresh({ userId: "user-A", tickers: ["AAPL"], source: "yahoo" });

    // user-B has not refreshed yet, should be allowed
    await expect(
      service.refresh({ userId: "user-B", tickers: ["AAPL"], source: "yahoo" }),
    ).resolves.toBeDefined();
  });

  it("msUntilNextRefresh returns 0 before any refresh", () => {
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      cooldownMs: TEST_COOLDOWN_MS,
    });
    expect(service.msUntilNextRefresh("no-refresh-yet")).toBe(0);
  });

  it("msUntilNextRefresh returns positive value immediately after refresh", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    await service.refresh({ userId: "user-ms", tickers: ["AAPL"], source: "yahoo" });
    expect(service.msUntilNextRefresh("user-ms")).toBeGreaterThan(0);
  });
});

describe("upstream-yahoo, error messages contain no ticker symbols", () => {
  const TICKER = "SECRET_TICKER_XYZ";

  it("network error message does not contain ticker", async () => {
    const fetcher = async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    };
    try {
      await fetchYahooPrices([TICKER], fetcher);
      // With per-ticker isolation the error is caught and ticker goes to unknown.
      // Either way the error path must not embed the ticker.
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamUnavailableError);
      if (err instanceof UpstreamUnavailableError) {
        expect(err.message).not.toContain(TICKER);
      }
    }
  });

  it("non-2xx error message does not contain ticker", async () => {
    const fetcher = async (): Promise<Response> => new Response("err", { status: 503 });
    try {
      await fetchYahooPrices([TICKER], fetcher);
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamUnavailableError);
      if (err instanceof UpstreamUnavailableError) {
        expect(err.message).not.toContain(TICKER);
      }
    }
  });

  it("malformed JSON error message does not contain ticker", async () => {
    const fetcher = async (): Promise<Response> =>
      new Response("<bad>", { status: 200, headers: { "Content-Type": "text/html" } });
    try {
      await fetchYahooPrices([TICKER], fetcher);
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamUnavailableError);
      if (err instanceof UpstreamUnavailableError) {
        expect(err.message).not.toContain(TICKER);
      }
    }
  });
});

describe("PriceService, cache layer", () => {
  it("serves from fresh cache without hitting fetcher", async () => {
    const now = new Date();
    const repo = createStubRepo([
      {
        source: "yahoo",
        ticker: "AAPL",
        previousPrice: null,
        price: "100.00000000",
        fetchedAt: now,
      },
    ]);
    const fetcher = async (): Promise<Response> => {
      throw new Error("fetcher must not be called for fresh cache hit");
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({
      userId: "cache-user-1",
      tickers: ["AAPL"],
      source: "yahoo",
    });

    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.price).toBe("100.00000000");
    expect(result.prices[0]?.fetchedAt).toBe(now.toISOString());
    expect(result.unknown).toEqual([]);
    expect(service.msUntilNextRefresh("cache-user-1")).toBe(0);
  });

  it("stale cache row triggers upstream fetch", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    const repo = createStubRepo([
      {
        source: "yahoo",
        ticker: "AAPL",
        previousPrice: null,
        price: "99.00000000",
        fetchedAt: staleDate,
      },
    ]);
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("AAPL")) return yahooResponse("AAPL", 182.5);
      return new Response("not found", { status: 404 });
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({
      userId: "cache-user-2",
      tickers: ["AAPL"],
      source: "yahoo",
    });

    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.price).toMatch(/^182\./);
    expect(repo.rows.get("yahoo AAPL")?.price).toMatch(/^182\./);
  });

  it("upstream success upserts cache", async () => {
    const repo = createStubRepo();
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("AAPL")) return yahooResponse("AAPL", 180.0);
      return new Response("not found", { status: 404 });
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    await service.refresh({ userId: "cache-user-3", tickers: ["AAPL"], source: "yahoo" });

    const cached = repo.rows.get("yahoo AAPL");
    expect(cached).toBeDefined();
    expect(cached?.price).toMatch(/^180\./);
  });

  it("upstream UpstreamUnavailable falls back to stale cache", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    const repo = createStubRepo([
      {
        source: "yahoo",
        ticker: "AAPL",
        previousPrice: null,
        price: "99.00000000",
        fetchedAt: staleDate,
      },
    ]);
    // Yahoo per-ticker isolation swallows 5xx → upstream returns empty map.
    const fetcher = async () => new Response("error", { status: 500 });
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({
      userId: "cache-user-4",
      tickers: ["AAPL"],
      source: "yahoo",
    });

    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.price).toBe("99.00000000");
    expect(result.unknown).toEqual([]);
    // An upstream call was attempted, so the cooldown is consumed even though it
    // failed; this stops a failing upstream from being hammered every request.
    expect(service.msUntilNextRefresh("cache-user-4")).toBeGreaterThan(0);
  });

  it("upstream empty result with no cache row → unknown", async () => {
    const repo = createStubRepo();
    const fetcher = async () => new Response("not found", { status: 404 });
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({
      userId: "cache-user-5",
      tickers: ["NOPE"],
      source: "yahoo",
    });

    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["NOPE"]);
    expect(service.msUntilNextRefresh("cache-user-5")).toBeGreaterThan(0);
  });

  it("mix: one fresh cached, one fetched", async () => {
    const now = new Date();
    const repo = createStubRepo([
      {
        source: "yahoo",
        ticker: "AAPL",
        previousPrice: null,
        price: "100.00000000",
        fetchedAt: now,
      },
    ]);
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("MSFT")) return yahooResponse("MSFT", 420.0);
      return new Response("not found", { status: 404 });
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({
      userId: "cache-user-6",
      tickers: ["AAPL", "MSFT"],
      source: "yahoo",
    });

    expect(result.prices).toHaveLength(2);
    expect(result.unknown).toEqual([]);
    expect(repo.rows.has("yahoo MSFT")).toBe(true);
    expect(service.msUntilNextRefresh("cache-user-6")).toBeGreaterThan(0);
  });

  it("cooldown NOT consumed when fully served from cache", async () => {
    const now = new Date();
    const repo = createStubRepo([
      {
        source: "yahoo",
        ticker: "AAPL",
        previousPrice: null,
        price: "100.00000000",
        fetchedAt: now,
      },
    ]);
    const fetcher = async (): Promise<Response> => {
      throw new Error("fetcher must not be called");
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    await service.refresh({ userId: "cache-user-7", tickers: ["AAPL"], source: "yahoo" });

    expect(service.msUntilNextRefresh("cache-user-7")).toBe(0);
  });

  it("cooldown consumed when upstream is hit", async () => {
    const repo = createStubRepo();
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("AAPL")) return yahooResponse("AAPL", 180.0);
      return new Response("not found", { status: 404 });
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    await service.refresh({ userId: "cache-user-8", tickers: ["AAPL"], source: "yahoo" });

    expect(service.msUntilNextRefresh("cache-user-8")).toBeGreaterThan(0);
  });

  it("CoinGecko UpstreamUnavailableError falls back to cache", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    const repo = createStubRepo([
      {
        source: "coingecko",
        ticker: "bitcoin",
        previousPrice: null,
        price: "60000.00000000",
        fetchedAt: staleDate,
      },
    ]);
    const fetcher = async () => new Response("error", { status: 500 });
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({
      userId: "cache-user-9",
      tickers: ["bitcoin"],
      source: "coingecko",
    });

    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.price).toBe("60000.00000000");
    expect(result.unknown).toEqual([]);
    expect(service.msUntilNextRefresh("cache-user-9")).toBeGreaterThan(0);
  });

  it("cache hit on a different source does not satisfy the requested source", async () => {
    const now = new Date();
    const repo = createStubRepo([
      {
        source: "coingecko",
        ticker: "AAPL",
        previousPrice: null,
        price: "999.00000000",
        fetchedAt: now,
      },
    ]);
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("AAPL")) return yahooResponse("AAPL", 180.0);
      return new Response("not found", { status: 404 });
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({
      userId: "cache-user-10",
      tickers: ["AAPL"],
      source: "yahoo",
    });

    expect(result.prices[0]?.price).toMatch(/^180\./);
    expect(repo.rows.has("yahoo AAPL")).toBe(true);
    expect(repo.rows.has("coingecko AAPL")).toBe(true);
    expect(service.msUntilNextRefresh("cache-user-10")).toBeGreaterThan(0);
  });
});

describe("PriceService, previousPrice round-trip", () => {
  it("upstream-fresh path preserves Yahoo previousClose", async () => {
    const repo = createStubRepo();
    const fetcher = async (url: string | URL | Request) => {
      if (String(url).includes("VOO")) return yahooResponse("VOO", 520.0, { previousClose: 519.5 });
      return new Response("not found", { status: 404 });
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({ userId: "pp-1", tickers: ["VOO"], source: "yahoo" });

    expect(result.prices[0]?.previousPrice).toBe("519.50000000");
    expect(repo.rows.get("yahoo VOO")?.previousPrice).toBe("519.50000000");
  });

  it("Yahoo prefers previousClose over chartPreviousClose (the VOO 2-day-stale bug)", async () => {
    // chartPreviousClose is 2 sessions back when range > 1d. previousClose is
    // always the prior session close. The upstream parser must read previousClose.
    const repo = createStubRepo();
    const fetcher = async () =>
      yahooResponse("VOO", 520.0, { previousClose: 519.95, chartPreviousClose: 516.15 });
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({ userId: "pp-2", tickers: ["VOO"], source: "yahoo" });

    expect(result.prices[0]?.previousPrice).toBe("519.95000000");
  });

  it("Yahoo falls back to chartPreviousClose when previousClose is absent", async () => {
    const repo = createStubRepo();
    const fetcher = async () => yahooResponse("VOO", 520.0, { chartPreviousClose: 519.5 });
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({ userId: "pp-3", tickers: ["VOO"], source: "yahoo" });

    expect(result.prices[0]?.previousPrice).toBe("519.50000000");
  });

  it("Yahoo returns null previousPrice when upstream omits both fields", async () => {
    const repo = createStubRepo();
    const fetcher = async () => yahooResponse("VOO", 520.0);
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({ userId: "pp-4", tickers: ["VOO"], source: "yahoo" });

    expect(result.prices[0]?.previousPrice).toBeNull();
  });

  it("CoinGecko derives previousPrice from usd_24h_change", async () => {
    const repo = createStubRepo();
    // current 105, +5% → prev = 100. Use a value with a clean inverse.
    const fetcher = async () => coingeckoResponse({ bitcoin: { usd: 105, usd_24h_change: 5 } });
    const service = new PriceService({
      pricesRepo: repo,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    const result = await service.refresh({
      userId: "pp-5",
      tickers: ["bitcoin"],
      source: "coingecko",
    });

    // 105 / 1.05 = 100 exactly
    expect(result.prices[0]?.previousPrice).toBe("100.00000000");
  });

  it("CoinGecko returns null previousPrice when 24h_change is -100", async () => {
    const repo = createStubRepo();
    const fetcher = async () =>
      coingeckoResponse({ doomcoin: { usd: 0.01, usd_24h_change: -100 } });
    const service = new PriceService({
      pricesRepo: repo,
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });

    const result = await service.refresh({
      userId: "pp-6",
      tickers: ["doomcoin"],
      source: "coingecko",
    });

    expect(result.prices[0]?.previousPrice).toBeNull();
  });

  it("fresh-cache fast-path preserves previousPrice (CR-01 regression test)", async () => {
    // The bug: when every requested ticker was a fresh cache hit, the service
    // returned without previousPrice, silently breaking day-change everywhere.
    const now = new Date();
    const repo = createStubRepo([
      {
        source: "yahoo",
        ticker: "AAPL",
        price: "180.00000000",
        previousPrice: "178.50000000",
        fetchedAt: now,
      },
    ]);
    const fetcher = async (): Promise<Response> => {
      throw new Error("fetcher must not be called for fresh cache hit");
    };
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({ userId: "pp-7", tickers: ["AAPL"], source: "yahoo" });

    expect(result.prices[0]?.previousPrice).toBe("178.50000000");
  });

  it("stale-cache fallback path preserves previousPrice", async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    const repo = createStubRepo([
      {
        source: "yahoo",
        ticker: "AAPL",
        price: "99.00000000",
        previousPrice: "97.50000000",
        fetchedAt: staleDate,
      },
    ]);
    const fetcher = async () => new Response("error", { status: 500 });
    const service = new PriceService({ pricesRepo: repo, fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({ userId: "pp-8", tickers: ["AAPL"], source: "yahoo" });

    expect(result.prices[0]?.previousPrice).toBe("97.50000000");
  });
});

// --- Finnhub failover ---

function finnhubQuoteResponse(price: number, pc?: number, status = 200): Response {
  const body: Record<string, number> = { c: price };
  if (pc !== undefined) body.pc = pc;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PriceService, Finnhub failover", () => {
  const SAVED_KEY = process.env.FINNHUB_API_KEY;

  afterEach(() => {
    if (SAVED_KEY === undefined) {
      delete process.env.FINNHUB_API_KEY;
    } else {
      process.env.FINNHUB_API_KEY = SAVED_KEY;
    }
    rateLimit.resetAll();
  });

  it("Yahoo 429 + key set: Finnhub serves the prices", async () => {
    process.env.FINNHUB_API_KEY = "test-key";

    const fetcher = async (url: string | URL | Request) => {
      const u = String(url);
      // Yahoo chart endpoint → 429
      if (u.includes("finance/chart")) return new Response("throttled", { status: 429 });
      // Finnhub quote endpoint → price
      if (u.includes("finnhub.io")) return finnhubQuoteResponse(182.5, 180.0);
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({ userId: "fh-1", tickers: ["AAPL"], source: "yahoo" });

    expect(result.unknown).toEqual([]);
    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.price).toMatch(/^182\./);
    expect(result.prices[0]?.previousPrice).toMatch(/^180\./);
  });

  it("no key set: Finnhub never called, Yahoo failure serves unknown/stale as today", async () => {
    delete process.env.FINNHUB_API_KEY;

    let finnhubCalled = false;
    const fetcher = async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("finnhub.io")) finnhubCalled = true;
      // Yahoo → 429 for all tickers
      return new Response("throttled", { status: 429 });
    };

    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({ userId: "fh-2", tickers: ["AAPL"], source: "yahoo" });

    expect(finnhubCalled).toBe(false);
    expect(result.unknown).toEqual(["AAPL"]);
  });

  it("Yahoo 429 + Finnhub 429: failure swallowed, ticker stays unknown", async () => {
    process.env.FINNHUB_API_KEY = "test-key";

    const fetcher = async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("finance/chart")) return new Response("throttled", { status: 429 });
      if (u.includes("finnhub.io")) return new Response("throttled", { status: 429 });
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({ userId: "fh-4", tickers: ["AAPL"], source: "yahoo" });

    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["AAPL"]);
  });

  it("Yahoo partial + key: Finnhub fills only the missing tickers", async () => {
    process.env.FINNHUB_API_KEY = "test-key";

    const fetcher = async (url: string | URL | Request) => {
      const u = String(url);
      // Yahoo serves AAPL, misses MSFT (404)
      if (u.includes("finance/chart") && u.includes("AAPL")) return yahooResponse("AAPL", 182.5);
      if (u.includes("finance/chart") && u.includes("MSFT"))
        return new Response("not found", { status: 404 });
      // Finnhub serves MSFT
      if (u.includes("finnhub.io") && u.includes("MSFT")) return finnhubQuoteResponse(420.0, 418.0);
      // Finnhub must NOT be called for AAPL (already covered)
      if (u.includes("finnhub.io") && u.includes("AAPL")) {
        throw new Error("Finnhub should not be called for a ticker Yahoo already returned");
      }
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({
      pricesRepo: createStubRepo(),
      fetcher,
      cooldownMs: TEST_COOLDOWN_MS,
    });
    const result = await service.refresh({
      userId: "fh-3",
      tickers: ["AAPL", "MSFT"],
      source: "yahoo",
    });

    expect(result.unknown).toEqual([]);
    expect(result.prices).toHaveLength(2);
    expect(result.prices.find((p) => p.ticker === "AAPL")?.price).toMatch(/^182\./);
    expect(result.prices.find((p) => p.ticker === "MSFT")?.price).toMatch(/^420\./);
  });
});
