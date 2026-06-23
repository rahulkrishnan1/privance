import { regionFromCountry } from "./_region.js";
import type { FetchLike, SymbolProfile } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function profileUrl(ticker: string, apiKey: string): string {
  return `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
}

function metricUrl(ticker: string, apiKey: string): string {
  return `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${encodeURIComponent(apiKey)}`;
}

const FETCH_TIMEOUT_MS = 15_000;

// Cap simultaneous outbound calls. Finnhub free tier allows 60 req/min;
// 6 concurrent keeps the fan-out well inside that budget.
const FETCH_CONCURRENCY = 6;

type FinnhubProfile = {
  name?: string;
  country?: string;
  currency?: string;
  exchange?: string;
  finnhubIndustry?: string;
  ticker?: string;
};

type FinnhubMetric = {
  metric?: {
    dividendYieldIndicatedAnnual?: number;
    currentDividendYieldTTM?: number;
  };
};

async function fetchProfile2(
  ticker: string,
  apiKey: string,
  fetcher: FetchLike,
): Promise<SymbolProfile | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetcher(profileUrl(ticker, apiKey), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
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

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new UpstreamUnavailableError("malformed upstream response");
  }

  if (typeof body !== "object" || body === null) return null;

  // Finnhub returns {} for unknown symbols.
  const raw = body as FinnhubProfile;
  if (!raw.name && !raw.ticker) return null;

  const country = raw.country ?? undefined;

  return {
    ticker,
    assetType: "stock",
    displayName: raw.name ?? undefined,
    sector: raw.finnhubIndustry ?? undefined,
    country,
    region: regionFromCountry(country),
    currency: raw.currency ?? undefined,
    exchange: raw.exchange ?? undefined,
    // Yield is filled separately from /stock/metric; the rest are not on the
    // Finnhub free tier and stay undefined (Yahoo-only enrichment).
    dividendYield: undefined,
    sectorWeightings: undefined,
    industry: undefined,
    assetClass: undefined,
    assetSubClass: undefined,
    figi: undefined,
    cusip: undefined,
    isin: undefined,
    fundCategory: undefined,
  };
}

// profile2 carries no yield, so read it from /stock/metric (Basic Financials,
// free tier). Finnhub reports the yield as a percent (0.5 = 0.5%); our domain
// stores a fraction, so divide by 100. Best-effort: a failure here must not sink
// the profile, since dividend yield is optional metadata.
async function fetchDividendYield(
  ticker: string,
  apiKey: string,
  fetcher: FetchLike,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(metricUrl(ticker, apiKey), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return undefined;
    const body = (await res.json()) as FinnhubMetric;
    // Take the first positive yield: indicated-annual (forward) preferred, then
    // TTM. `??` alone would pick a 0 indicated-annual over a real TTM yield.
    const pct = [
      body.metric?.dividendYieldIndicatedAnnual,
      body.metric?.currentDividendYieldTTM,
    ].find((v) => typeof v === "number" && Number.isFinite(v) && v > 0);
    if (pct === undefined) return undefined;
    return (pct / 100).toFixed(6);
  } catch {
    clearTimeout(timeoutId);
    return undefined;
  }
}

async function fetchOneProfile(
  ticker: string,
  apiKey: string,
  fetcher: FetchLike,
): Promise<SymbolProfile | null> {
  const [profile, dividendYield] = await Promise.all([
    fetchProfile2(ticker, apiKey, fetcher),
    fetchDividendYield(ticker, apiKey, fetcher),
  ]);
  if (profile === null) return null;
  return dividendYield === undefined ? profile : { ...profile, dividendYield };
}

/**
 * Fetches instrument profiles from Finnhub for a list of tickers.
 * Returns a map of ticker → profile; tickers with no data are omitted.
 * Throws UpstreamUnavailableError on network failure or upstream 5xx/429.
 */
export async function fetchFinnhubProfiles(
  tickers: string[],
  apiKey: string,
  fetcher: FetchLike = globalThis.fetch,
): Promise<Map<string, SymbolProfile>> {
  if (tickers.length === 0) return new Map();

  const out = new Map<string, SymbolProfile>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tickers.length) {
      const ticker = tickers[next++];
      if (ticker === undefined) return;
      try {
        const result = await fetchOneProfile(ticker, apiKey, fetcher);
        if (result !== null) out.set(ticker, result);
      } catch (err) {
        // Per-ticker upstream failure isolated to "unknown": one bad ticker
        // shouldn't fail the whole batch.
        if (!(err instanceof UpstreamUnavailableError)) throw err;
      }
    }
  }

  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, tickers.length) }, worker);
  await Promise.all(workers);
  return out;
}
