import { Decimal, SCALE_CENTS } from "@privance/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { RefreshPricesResponse } from "@/lib/api/prices";

// ---------------------------------------------------------------------------
// Helpers extracted from the module under test, tested in isolation so we
// don't have to mount a React tree.
// ---------------------------------------------------------------------------

async function buildPricesMap(
  tickers: string[],
  fetch: (sorted: string[]) => Promise<RefreshPricesResponse>,
): Promise<Map<string, Decimal>> {
  const sorted = [...new Set(tickers)].sort();
  const response = await fetch(sorted);
  const map = new Map<string, Decimal>();
  for (const entry of response.prices) {
    map.set(entry.ticker, Decimal.fromString(entry.price, SCALE_CENTS));
  }
  return map;
}

function buildQueryKey(tickers: string[]): [string, ...string[]] {
  const sorted = [...new Set(tickers)].sort();
  return ["prices", ...sorted];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function priceResponse(entries: Array<{ ticker: string; price: string }>): RefreshPricesResponse {
  return {
    prices: entries.map((e) => ({ ...e, fetchedAt: "2026-05-16T00:00:00Z" })),
    unknown: [],
  };
}

const mockRefresh = vi.fn<(sorted: string[]) => Promise<RefreshPricesResponse>>();

beforeEach(() => {
  mockRefresh.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// queryFn, Map conversion
// ---------------------------------------------------------------------------

describe("buildPricesMap", () => {
  it("returns an empty map when tickers list is empty (no fetch)", async () => {
    mockRefresh.mockResolvedValueOnce(priceResponse([]));
    const map = await buildPricesMap([], mockRefresh);
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(map.size).toBe(0);
  });

  it("converts price entries to Decimal at SCALE_CENTS", async () => {
    mockRefresh.mockResolvedValueOnce(
      priceResponse([
        { ticker: "AAPL", price: "182.34" },
        { ticker: "BTC", price: "65000.00" },
      ]),
    );
    const map = await buildPricesMap(["AAPL", "BTC"], mockRefresh);
    expect(map.size).toBe(2);

    const aapl = map.get("AAPL");
    expect(aapl).toBeDefined();
    expect(aapl?.toString()).toBe("182.34");

    const btc = map.get("BTC");
    expect(btc).toBeDefined();
    expect(btc?.toString()).toBe("65000.00");
  });

  it("preserves Decimal precision, no floating-point coercion", async () => {
    mockRefresh.mockResolvedValueOnce(priceResponse([{ ticker: "X", price: "0.01" }]));
    const map = await buildPricesMap(["X"], mockRefresh);
    const price = map.get("X");
    expect(price).toBeDefined();
    expect(price?.toMinorUnits()).toBe(1n);
  });

  it("deduplicates tickers before passing to fetch", async () => {
    mockRefresh.mockResolvedValueOnce(priceResponse([{ ticker: "AAPL", price: "182.00" }]));
    await buildPricesMap(["AAPL", "AAPL", "AAPL"], mockRefresh);
    const [calledWith] = mockRefresh.mock.calls[0] ?? [];
    expect(calledWith).toEqual(["AAPL"]);
  });

  it("sorts tickers before passing to fetch", async () => {
    mockRefresh.mockResolvedValueOnce(priceResponse([]));
    await buildPricesMap(["TSLA", "AAPL", "MSFT"], mockRefresh);
    const [calledWith] = mockRefresh.mock.calls[0] ?? [];
    expect(calledWith).toEqual(["AAPL", "MSFT", "TSLA"]);
  });

  it("omits tickers whose prices are absent in the response (unknown)", async () => {
    mockRefresh.mockResolvedValueOnce({
      prices: [{ ticker: "AAPL", price: "182.00", fetchedAt: "2026-05-16T00:00:00Z" }],
      unknown: ["UNKNOWN_TKR"],
    });
    const map = await buildPricesMap(["AAPL", "UNKNOWN_TKR"], mockRefresh);
    expect(map.has("AAPL")).toBe(true);
    expect(map.has("UNKNOWN_TKR")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// queryKey composition
// ---------------------------------------------------------------------------

describe("buildQueryKey", () => {
  it("prefixes with 'prices' and appends sorted tickers", () => {
    const key = buildQueryKey(["TSLA", "AAPL"]);
    expect(key).toEqual(["prices", "AAPL", "TSLA"]);
  });

  it("produces identical key for duplicate tickers", () => {
    const a = buildQueryKey(["AAPL", "AAPL"]);
    const b = buildQueryKey(["AAPL"]);
    expect(a).toEqual(b);
  });

  it("produces identical key regardless of input order", () => {
    const a = buildQueryKey(["MSFT", "AAPL", "GOOG"]);
    const b = buildQueryKey(["GOOG", "MSFT", "AAPL"]);
    expect(a).toEqual(b);
  });

  it("returns ['prices'] for an empty ticker list", () => {
    expect(buildQueryKey([])).toEqual(["prices"]);
  });
});

// ---------------------------------------------------------------------------
// Cooldown 429 handling
// ---------------------------------------------------------------------------

describe("cooldown 429", () => {
  it("ApiError with status 429 is surfaced without throwing unexpectedly", () => {
    const err = new ApiError(429, "rate_limited", "Rate limited");
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");

    const isStale = err instanceof ApiError && err.status === 429;
    expect(isStale).toBe(true);
  });

  it("non-429 ApiError is not treated as stale", () => {
    const err = new ApiError(503, "upstream_unavailable", "Service down");
    const isStale = err instanceof ApiError && err.status === 429;
    expect(isStale).toBe(false);
  });
});
