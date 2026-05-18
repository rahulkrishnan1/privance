import { regionFromCountry } from "./_region.js";
import type { AssetType, FetchLike, SymbolProfile } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

// Yahoo Finance v11 quoteSummary, assetProfile + summaryDetail modules give us
// sector, industry, country, currency and display name in a single call.
const YAHOO_BASE = "https://query1.finance.yahoo.com";

function quoteSummaryUrl(ticker: string): string {
  const modules = "assetProfile,summaryDetail,quoteType";
  return `${YAHOO_BASE}/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}`;
}

const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Response shape (partial, only the fields we consume)
// ---------------------------------------------------------------------------

type YahooQuoteSummaryResponse = {
  quoteSummary: {
    result:
      | Array<{
          assetProfile?: {
            country?: string;
            sector?: string;
            industry?: string;
            longBusinessSummary?: string;
          };
          summaryDetail?: {
            currency?: string;
          };
          quoteType?: {
            shortName?: string;
            longName?: string;
            quoteType?: string;
            exchange?: string;
          };
        }>
      | null
      | undefined;
    error?: { description?: string } | null;
  };
};

// ---------------------------------------------------------------------------
// quoteType → AssetType + assetClass mapping
// ---------------------------------------------------------------------------

function mapQuoteType(quoteType: string | undefined): {
  assetType: AssetType;
  assetClass: string | undefined;
} {
  switch (quoteType?.toUpperCase()) {
    case "ETF":
      return { assetType: "stock", assetClass: "etf" };
    case "MUTUALFUND":
      return { assetType: "stock", assetClass: "mutual_fund" };
    case "EQUITY":
      return { assetType: "stock", assetClass: "equity" };
    case "CRYPTOCURRENCY":
      return { assetType: "crypto", assetClass: undefined };
    case "BOND":
      return { assetType: "stock", assetClass: "fixed_income" };
    default:
      // Default to stock/equity for unknown types, caller can override.
      return { assetType: "stock", assetClass: undefined };
  }
}

// ---------------------------------------------------------------------------
// Per-ticker fetch
// ---------------------------------------------------------------------------

async function fetchOneProfile(ticker: string, fetcher: FetchLike): Promise<SymbolProfile | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    // Generic browser UA: Yahoo 429s no-UA requests as bots. No user IP or
    // user-identifying headers forwarded.
    res = await fetcher(quoteSummaryUrl(ticker), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw new UpstreamUnavailableError(`network error fetching upstream: ${String(err)}`);
  }
  clearTimeout(timeoutId);

  if (res.status === 429 || res.status >= 500) {
    // Mask upstream 429/5xx, do not expose upstream identity to callers.
    throw new UpstreamUnavailableError("upstream returned non-2xx");
  }

  if (!res.ok) {
    // 4xx other than 429 → treat as unknown ticker.
    return null;
  }

  let body: YahooQuoteSummaryResponse;
  try {
    body = (await res.json()) as YahooQuoteSummaryResponse;
  } catch {
    throw new UpstreamUnavailableError("malformed upstream response");
  }

  const result = body?.quoteSummary?.result;
  if (!Array.isArray(result) || result.length === 0 || result[0] == null) return null;

  const entry = result[0];
  const quoteTypeStr = entry.quoteType?.quoteType;
  const { assetType, assetClass } = mapQuoteType(quoteTypeStr);

  const displayName = entry.quoteType?.longName ?? entry.quoteType?.shortName ?? undefined;

  const country = entry.assetProfile?.country ?? undefined;

  return {
    ticker,
    assetType,
    displayName,
    assetClass,
    sector: entry.assetProfile?.sector ?? undefined,
    industry: entry.assetProfile?.industry ?? undefined,
    country,
    // Yahoo doesn't expose region directly; derive from country so the
    // dashboard's geography pie has something to bucket on.
    region: regionFromCountry(country),
    currency: entry.summaryDetail?.currency ?? undefined,
    exchange: entry.quoteType?.exchange ?? undefined,
    // Fields not available from Yahoo quoteSummary v11:
    figi: undefined,
    cusip: undefined,
    isin: undefined,
    assetSubClass: undefined,
  };
}

// ---------------------------------------------------------------------------
// Batch fetch
// ---------------------------------------------------------------------------

/**
 * Fetches instrument profiles from Yahoo Finance for a list of tickers.
 * Returns a map of ticker → profile; tickers with no data are omitted.
 * Throws UpstreamUnavailableError on network failure or upstream 5xx/429.
 */
export async function fetchYahooProfiles(
  tickers: string[],
  fetcher: FetchLike = globalThis.fetch,
): Promise<Map<string, SymbolProfile>> {
  if (tickers.length === 0) return new Map();

  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const profile = await fetchOneProfile(ticker, fetcher);
        return [ticker, profile] as const;
      } catch (err) {
        if (err instanceof UpstreamUnavailableError) {
          // Per-ticker upstream failure, treat as unknown rather than propagating.
          return [ticker, null] as const;
        }
        throw err;
      }
    }),
  );

  const out = new Map<string, SymbolProfile>();
  for (const [ticker, profile] of entries) {
    if (profile !== null) out.set(ticker, profile);
  }
  return out;
}
