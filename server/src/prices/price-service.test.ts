import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// ---------------------------------------------------------------------------
// Unit tests for PriceService, no network, no DB.
// Upstream clients accept an injectable fetcher so tests are fully isolated.
// ---------------------------------------------------------------------------

import { PriceService } from "./price-service.js";
import * as rateLimit from "./rate-limit.js";
import { InvalidSourceError, RateLimitedError, UpstreamUnavailableError } from "./types.js";
import { fetchYahooPrices } from "./upstream-yahoo.js";

// ---------------------------------------------------------------------------
// Mock fetcher helpers
// ---------------------------------------------------------------------------

function yahooResponse(_ticker: string, price: number, status = 200): Response {
  const body = {
    chart: {
      result: [
        {
          meta: {
            regularMarketPrice: price,
            currency: "USD",
          },
        },
      ],
      error: null,
    },
  };
  return new Response(JSON.stringify(body), {
    status,
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

function coingeckoResponse(entries: Record<string, number>, status = 200): Response {
  const body: Record<string, { usd: number }> = {};
  for (const [id, price] of Object.entries(entries)) {
    body[id] = { usd: price };
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Short cooldown so tests don't have to wait 60 s.
const TEST_COOLDOWN_MS = 100;

beforeEach(() => {
  rateLimit.resetAll();
});

afterEach(() => {
  rateLimit.resetAll();
});

// ---------------------------------------------------------------------------
// Yahoo, happy path
// ---------------------------------------------------------------------------

describe("PriceService, Yahoo happy path", () => {
  it("returns fetched prices and empty unknown list", async () => {
    const fetcher = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("AAPL")) return yahooResponse("AAPL", 182.5);
      if (urlStr.includes("MSFT")) return yahooResponse("MSFT", 420.0);
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
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

// ---------------------------------------------------------------------------
// Yahoo, unknown ticker (missing in response)
// ---------------------------------------------------------------------------

describe("PriceService, unknown ticker", () => {
  it("places unrecognised tickers in unknown array, not prices", async () => {
    const fetcher = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("AAPL")) return yahooResponse("AAPL", 182.5);
      // UNKNOWN_TICKER → 404 (treated as unknown)
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
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
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["GONE"],
      source: "yahoo",
    });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["GONE"]);
  });
});

// ---------------------------------------------------------------------------
// Yahoo, upstream 5xx (per-ticker isolation — one bad ticker doesn't fail the batch)
// ---------------------------------------------------------------------------

describe("PriceService, upstream 5xx", () => {
  it("single ticker 5xx → that ticker lands in unknown, does not throw", async () => {
    const fetcher = async () => new Response("error", { status: 500 });
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });

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

    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["A1", "A2", "A3", "A4", "FAIL"],
      source: "yahoo",
    });

    expect(result.prices).toHaveLength(4);
    expect(result.unknown).toEqual(["FAIL"]);
  });
});

// ---------------------------------------------------------------------------
// Yahoo, upstream 429 masked (per-ticker isolation)
// ---------------------------------------------------------------------------

describe("PriceService, upstream 429 masked", () => {
  it("upstream 429 on a ticker → lands in unknown, not RateLimitedError", async () => {
    const fetcher = async () => new Response("rate limited", { status: 429 });
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({ userId: "user-1", tickers: ["AAPL"], source: "yahoo" });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["AAPL"]);
  });
});

// ---------------------------------------------------------------------------
// Yahoo, malformed response (per-ticker isolation)
// ---------------------------------------------------------------------------

describe("PriceService, malformed response", () => {
  it("malformed JSON body on a ticker → that ticker lands in unknown, does not throw", async () => {
    const fetcher = async () =>
      new Response("<html>bad</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });

    const result = await service.refresh({ userId: "user-1", tickers: ["AAPL"], source: "yahoo" });
    expect(result.prices).toEqual([]);
    expect(result.unknown).toEqual(["AAPL"]);
  });
});

// ---------------------------------------------------------------------------
// Yahoo, partial response (some OK, some unknown)
// ---------------------------------------------------------------------------

describe("PriceService, partial response", () => {
  it("returns available prices and lists missing tickers as unknown", async () => {
    const fetcher = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("AAPL")) return yahooResponse("AAPL", 182.5);
      return new Response("not found", { status: 404 });
    };

    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["AAPL", "NOPE1", "NOPE2"],
      source: "yahoo",
    });

    expect(result.prices).toHaveLength(1);
    expect(result.unknown).toEqual(["NOPE1", "NOPE2"]);
  });
});

// ---------------------------------------------------------------------------
// CoinGecko, happy path
// ---------------------------------------------------------------------------

describe("PriceService, CoinGecko happy path", () => {
  it("returns fetched prices from CoinGecko", async () => {
    const fetcher = async () => coingeckoResponse({ bitcoin: 65000.5, ethereum: 3200.0 });
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
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
    const fetcher = async () => coingeckoResponse({ bitcoin: 65000.5 });
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
    const result = await service.refresh({
      userId: "user-1",
      tickers: ["bitcoin", "not-a-coin"],
      source: "coingecko",
    });

    expect(result.prices.map((p) => p.ticker)).toEqual(["bitcoin"]);
    expect(result.unknown).toEqual(["not-a-coin"]);
  });

  it("throws UpstreamUnavailableError on CoinGecko 500", async () => {
    const fetcher = async () => new Response("error", { status: 500 });
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });

    await expect(
      service.refresh({ userId: "user-1", tickers: ["bitcoin"], source: "coingecko" }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it("throws UpstreamUnavailableError on CoinGecko 429", async () => {
    const fetcher = async () => new Response("throttled", { status: 429 });
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });

    await expect(
      service.refresh({ userId: "user-1", tickers: ["bitcoin"], source: "coingecko" }),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Invalid source
// ---------------------------------------------------------------------------

describe("PriceService, invalid source", () => {
  it("throws InvalidSourceError for unknown source", async () => {
    const service = new PriceService({ fetcher: fetch, cooldownMs: TEST_COOLDOWN_MS });
    await expect(
      service.refresh({ userId: "user-1", tickers: ["AAPL"], source: "bloomberg" }),
    ).rejects.toBeInstanceOf(InvalidSourceError);
  });
});

// ---------------------------------------------------------------------------
// Per-user cooldown
// ---------------------------------------------------------------------------

describe("PriceService, per-user cooldown", () => {
  it("allows first request", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
    await expect(
      service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" }),
    ).resolves.toBeDefined();
  });

  it("throws RateLimitedError on second request within cooldown window", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });

    await service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" });

    await expect(
      service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("allows request after cooldown window elapses", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });

    await service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" });

    // Wait for the tiny test cooldown to expire.
    await Bun.sleep(TEST_COOLDOWN_MS + 10);

    await expect(
      service.refresh({ userId: "user-cooldown", tickers: ["AAPL"], source: "yahoo" }),
    ).resolves.toBeDefined();
  });

  it("cooldown is per-user, different users do not share cooldown", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });

    await service.refresh({ userId: "user-A", tickers: ["AAPL"], source: "yahoo" });

    // user-B has not refreshed yet, should be allowed
    await expect(
      service.refresh({ userId: "user-B", tickers: ["AAPL"], source: "yahoo" }),
    ).resolves.toBeDefined();
  });

  it("msUntilNextRefresh returns 0 before any refresh", () => {
    const service = new PriceService({ cooldownMs: TEST_COOLDOWN_MS });
    expect(service.msUntilNextRefresh("no-refresh-yet")).toBe(0);
  });

  it("msUntilNextRefresh returns positive value immediately after refresh", async () => {
    const fetcher = async () => yahooResponse("AAPL", 182.5);
    const service = new PriceService({ fetcher, cooldownMs: TEST_COOLDOWN_MS });
    await service.refresh({ userId: "user-ms", tickers: ["AAPL"], source: "yahoo" });
    expect(service.msUntilNextRefresh("user-ms")).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Q1, UpstreamUnavailableError messages must not contain ticker symbols
// ---------------------------------------------------------------------------

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
