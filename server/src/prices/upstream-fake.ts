import type { UpstreamPrice } from "./types.js";

/**
 * Deterministic price provider for E2E tests and local dev. Selected via
 * PRICE_PROVIDER=fake. Returns hardcoded values for the tickers the E2E
 * suite exercises; everything else lands in the "unknown" bucket so the
 * "unknown ticker" code paths still get coverage.
 */
const FAKE_PRICES: Record<string, string> = {
  AAPL: "180.00",
  MSFT: "400.00",
  GOOG: "150.00",
  NVDA: "120.00",
  VOO: "500.00",
  FXAIX: "180.00",
  bitcoin: "65000.00",
  ethereum: "3000.00",
};

const FAKE_UNKNOWN: Set<string> = new Set(
  (process.env.PRICE_FAKE_UNKNOWN ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0),
);

export function fetchFakePrices(tickers: string[]): Map<string, UpstreamPrice> {
  const result = new Map<string, UpstreamPrice>();
  const fetchedAt = new Date().toISOString();
  for (const ticker of tickers) {
    if (FAKE_UNKNOWN.has(ticker.toLowerCase())) continue;
    const price = FAKE_PRICES[ticker];
    if (price !== undefined) {
      result.set(ticker, { price, fetchedAt });
    }
  }
  return result;
}
