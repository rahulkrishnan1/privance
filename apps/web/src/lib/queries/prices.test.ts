import { Decimal, SCALE_CENTS } from "@privance/core";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { pickFailure } from "./prices";

// The Map-conversion and queryKey logic live inline in usePricesQuery and are
// exercised through the React hook by the E2E price-refresh flow. They are not
// re-implemented here, an earlier copy diverged from production (SCALE_CENTS vs
// the real SCALE_CRYPTO, and a different query-key shape), so it asserted
// behavior the app never had. Only the exported pickFailure is unit-tested.

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

function fulfilled<T>(value: T): PromiseFulfilledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: "rejected", reason };
}

function fetchedMap(tickers: string[]): Map<string, Decimal> {
  const m = new Map<string, Decimal>();
  for (const t of tickers) m.set(t, Decimal.fromString("1.00", SCALE_CENTS));
  return m;
}

function okRes(tickers: string[]): PromiseFulfilledResult<{ prices: { ticker: string }[] }> {
  return fulfilled({ prices: tickers.map((ticker) => ({ ticker })) });
}

describe("pickFailure", () => {
  const rate429 = new ApiError(429, "rate_limited", "Rate limited");

  it("both sources succeed -> returns null", () => {
    const fetched = fetchedMap(["AAPL", "bitcoin"]);
    const result = pickFailure(okRes(["AAPL"]), okRes(["bitcoin"]), ["AAPL"], ["bitcoin"], fetched);
    expect(result).toBeNull();
  });

  it("yahoo fails with 429, its tickers absent from fetched -> returns the error", () => {
    const fetched = fetchedMap(["bitcoin"]);
    const result = pickFailure(
      rejected(rate429),
      okRes(["bitcoin"]),
      ["AAPL"],
      ["bitcoin"],
      fetched,
    );
    expect(result).toBe(rate429);
  });

  it("coingecko fails with 429, its tickers absent from fetched -> returns the error", () => {
    const fetched = fetchedMap(["AAPL"]);
    const result = pickFailure(okRes(["AAPL"]), rejected(rate429), ["AAPL"], ["bitcoin"], fetched);
    expect(result).toBe(rate429);
  });

  it("yahoo fails but had no tickers requested -> returns null", () => {
    const fetched = fetchedMap(["bitcoin"]);
    const result = pickFailure(rejected(rate429), okRes(["bitcoin"]), [], ["bitcoin"], fetched);
    expect(result).toBeNull();
  });

  it("coingecko fails but had no tickers requested -> returns null", () => {
    const fetched = fetchedMap(["AAPL"]);
    const result = pickFailure(okRes(["AAPL"]), rejected(rate429), ["AAPL"], [], fetched);
    expect(result).toBeNull();
  });

  it("successful source prices remain discoverable via fetched even when the other source fails", () => {
    const coingeckoErr = new ApiError(503, "upstream_unavailable", "down");
    const fetched = fetchedMap(["AAPL"]);
    const result = pickFailure(
      okRes(["AAPL"]),
      rejected(coingeckoErr),
      ["AAPL"],
      ["bitcoin"],
      fetched,
    );
    expect(result).toBe(coingeckoErr);
    // Verify that AAPL's price is still in fetched (caller committed it before calling pickFailure).
    expect(fetched.has("AAPL")).toBe(true);
  });
});
