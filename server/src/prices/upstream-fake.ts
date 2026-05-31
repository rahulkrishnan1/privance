import type { UpstreamPrice } from "./types.js";

/**
 * Deterministic price provider for E2E tests and local dev. Selected via
 * PRICE_PROVIDER=fake. Returns hardcoded values for the tickers the E2E
 * suite exercises; everything else lands in the "unknown" bucket so the
 * "unknown ticker" code paths still get coverage.
 */
// Each entry is [currentPrice, previousClose]. previousClose can be null to
// exercise the "no prior price" path; today every ticker has one.
const FAKE_PRICES: Record<string, [string, string | null]> = {
  AAPL: ["180.00", "178.50"],
  MSFT: ["400.00", "402.10"],
  GOOG: ["150.00", "149.20"],
  NVDA: ["120.00", "118.75"],
  VOO: ["500.00", "499.10"],
  // Formerly-restricted holding with no public quote, used to exercise the
  // proxy un-anchor path: anchored to VOO while illiquid, priced directly here
  // as if it had since listed.
  PRVT: ["300.00", "298.50"],
  FXAIX: ["180.00", "179.60"],
  bitcoin: ["65000.00", "64200.00"],
  ethereum: ["3000.00", "3060.00"],
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
    const entry = FAKE_PRICES[ticker];
    if (entry !== undefined) {
      const [price, previousPrice] = entry;
      result.set(ticker, { price, previousPrice, fetchedAt });
    }
  }
  return result;
}
