import type { FetchLike, UpstreamPrice } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function quoteUrl(ticker: string, apiKey: string): string {
  return `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
}

const FETCH_TIMEOUT_MS = 15_000;

// Cap simultaneous outbound calls. Finnhub free tier allows 60 req/min;
// 6 concurrent keeps the fan-out well inside that budget.
const FETCH_CONCURRENCY = 6;

type FinnhubQuote = {
  c?: number; // current price
  pc?: number; // previous close
};

function parseQuote(body: unknown): FinnhubQuote | null {
  if (typeof body !== "object" || body === null) return null;
  return body as FinnhubQuote;
}

async function fetchOneTicker(
  ticker: string,
  apiKey: string,
  fetcher: FetchLike,
): Promise<UpstreamPrice | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetcher(quoteUrl(ticker, apiKey), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw new UpstreamUnavailableError(`network error fetching upstream: ${String(err)}`);
  }
  clearTimeout(timeoutId);

  if (res.status === 429 || res.status >= 500) {
    // Mask upstream 429/5xx, do not expose upstream choice to callers.
    throw new UpstreamUnavailableError("upstream returned non-2xx");
  }

  if (!res.ok) {
    // 4xx other than 429 (e.g. 403 bad key, 404 unknown ticker) → treat as unknown.
    return null;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new UpstreamUnavailableError("malformed upstream response");
  }

  const quote = parseQuote(body);
  if (quote === null) return null;

  const price = quote.c;
  // Finnhub returns c=0 for unknown or unpriced symbols.
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;

  // Represent prices as fixed-8 decimal strings (no floating-point arithmetic on the value).
  const decimal = price.toFixed(8);

  const prev = quote.pc;
  // Reject sub-cent priors (1e-8) to avoid "0.00000000" slipping through as
  // a divide-by-zero hazard for downstream day-change math.
  const previousPrice =
    typeof prev === "number" && Number.isFinite(prev) && prev >= 1e-8 ? prev.toFixed(8) : null;

  return {
    price: decimal,
    previousPrice,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetches prices from Finnhub for a list of tickers.
 * Returns a map of ticker → price entry; tickers with no data are omitted.
 * Throws UpstreamUnavailableError on network failure or upstream 5xx/429.
 */
export async function fetchFinnhubPrices(
  tickers: string[],
  apiKey: string,
  fetcher: FetchLike = globalThis.fetch,
): Promise<Map<string, UpstreamPrice>> {
  if (tickers.length === 0) return new Map();

  const out = new Map<string, UpstreamPrice>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tickers.length) {
      const ticker = tickers[next++];
      if (ticker === undefined) return;
      try {
        const result = await fetchOneTicker(ticker, apiKey, fetcher);
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
