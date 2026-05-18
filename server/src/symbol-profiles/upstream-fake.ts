import type { SymbolProfile } from "./types.js";

/**
 * Deterministic symbol-profile provider for E2E tests and local dev.
 * Selected via PRICE_PROVIDER=fake. Mirrors prices/upstream-fake so the
 * dashboard allocation pies render with predictable labels.
 */
const FAKE_PROFILES: Record<string, SymbolProfile> = {
  AAPL: {
    ticker: "AAPL",
    assetType: "stock",
    displayName: "Apple Inc.",
    assetClass: "equity",
    sector: "Technology",
    industry: "Consumer Electronics",
    country: "US",
    region: "North America",
    currency: "USD",
    exchange: "XNAS",
  },
  MSFT: {
    ticker: "MSFT",
    assetType: "stock",
    displayName: "Microsoft Corporation",
    assetClass: "equity",
    sector: "Technology",
    industry: "Software",
    country: "US",
    region: "North America",
    currency: "USD",
    exchange: "XNAS",
  },
  GOOG: {
    ticker: "GOOG",
    assetType: "stock",
    displayName: "Alphabet Inc.",
    assetClass: "equity",
    sector: "Communication Services",
    industry: "Internet Content",
    country: "US",
    region: "North America",
    currency: "USD",
    exchange: "XNAS",
  },
  NVDA: {
    ticker: "NVDA",
    assetType: "stock",
    displayName: "NVIDIA Corporation",
    assetClass: "equity",
    sector: "Technology",
    industry: "Semiconductors",
    country: "US",
    region: "North America",
    currency: "USD",
    exchange: "XNAS",
  },
  VOO: {
    ticker: "VOO",
    assetType: "stock",
    displayName: "Vanguard S&P 500 ETF",
    assetClass: "etf",
    country: "US",
    region: "North America",
    currency: "USD",
    exchange: "ARCX",
  },
};

export function fetchFakeProfiles(tickers: string[]): Map<string, SymbolProfile> {
  const result = new Map<string, SymbolProfile>();
  for (const ticker of tickers) {
    const profile = FAKE_PROFILES[ticker];
    if (profile !== undefined) {
      result.set(ticker, profile);
    }
  }
  return result;
}
