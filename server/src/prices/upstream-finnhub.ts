import type { FetchLike, StockPriceResult, UpstreamPrice } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function providerUrl(path: string, ticker: string, apiKey: string): string {
  return `${FINNHUB_BASE}/${path}?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
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

async function fetchBody(url: string, fetcher: FetchLike): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (res.status === 429 || res.status >= 500) {
      throw new UpstreamUnavailableError("upstream returned non-2xx");
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    throw new UpstreamUnavailableError("upstream request failed");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchOneTicker(
  ticker: string,
  apiKey: string,
  fetcher: FetchLike,
): Promise<UpstreamPrice | "unsupported" | null> {
  // /quote has no currency; profile2 must positively establish USD first.
  const profile = await fetchBody(providerUrl("stock/profile2", ticker, apiKey), fetcher);
  if (profile === null) return null;
  if (typeof profile !== "object" || (profile as { currency?: unknown }).currency !== "USD") {
    return "unsupported";
  }
  const body = await fetchBody(providerUrl("quote", ticker, apiKey), fetcher);

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
 * Returns validated USD prices and currency-rejected tickers separately.
 * Network failures and upstream 5xx/429 are isolated to the affected ticker.
 */
export async function fetchFinnhubPrices(
  tickers: string[],
  apiKey: string,
  fetcher: FetchLike = globalThis.fetch,
): Promise<StockPriceResult> {
  const out = new Map<string, UpstreamPrice>();
  const unsupported = new Set<string>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tickers.length) {
      const ticker = tickers[next++];
      if (ticker === undefined) return;
      try {
        const result = await fetchOneTicker(ticker, apiKey, fetcher);
        if (result === "unsupported") unsupported.add(ticker);
        else if (result !== null) out.set(ticker, result);
      } catch (err) {
        // Per-ticker upstream failure isolated to "unknown": one bad ticker
        // shouldn't fail the whole batch.
        if (!(err instanceof UpstreamUnavailableError)) throw err;
      }
    }
  }

  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, tickers.length) }, worker);
  await Promise.all(workers);
  return { prices: out, unsupported };
}
