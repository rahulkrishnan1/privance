import type { FetchLike, UpstreamPrice } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

const YAHOO_BASE = "https://query1.finance.yahoo.com";
// Yahoo v8 chart endpoint, one ticker per call; batch via Promise.all.
// `range=1d` so `chartPreviousClose` aligns with the broker's "previous close"
// (close before the only bar in the range = previous session close). With
// wider ranges, `chartPreviousClose` is the close before the *first* bar and
// drifts multiple sessions back. `previousClose` (preferred) matches what
// brokers display; we read it primarily and fall back to chartPreviousClose.
const YAHOO_CHART_PATH = (ticker: string) =>
  `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;

const FETCH_TIMEOUT_MS = 15_000;

// Cap simultaneous outbound calls. Yahoo allows one ticker per request, so a
// large batch would otherwise open one socket per ticker at once; 6 keeps the
// fan-out polite to the free tier while still parallelising.
const FETCH_CONCURRENCY = 6;

type YahooMeta = {
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
};

function parseChartMeta(body: unknown): YahooMeta | null {
  if (typeof body !== "object" || body === null) return null;
  const chart = (body as { chart?: unknown }).chart;
  if (typeof chart !== "object" || chart === null) return null;
  const result = (chart as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const first = result[0];
  if (typeof first !== "object" || first === null) return null;
  const meta = (first as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return null;
  return meta as YahooMeta;
}

async function fetchOneTicker(ticker: string, fetcher: FetchLike): Promise<UpstreamPrice | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    // Generic browser UA: Yahoo 429s no-UA requests as bots. No user IP or
    // user-identifying headers forwarded; the server's IP hits Yahoo either way.
    res = await fetcher(YAHOO_CHART_PATH(ticker), {
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
    // Mask upstream 429/5xx, do not expose upstream choice to callers.
    throw new UpstreamUnavailableError("upstream returned non-2xx");
  }

  if (!res.ok) {
    // 4xx other than 429 (e.g. 404 unknown ticker) → treat as unknown
    return null;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new UpstreamUnavailableError("malformed upstream response");
  }

  const meta = parseChartMeta(body);
  if (meta === null) return null;

  const price = meta.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;

  // Represent prices as fixed-8 decimal strings (no floating-point arithmetic on the value).
  const decimal = price.toFixed(8);

  const prev = meta.previousClose ?? meta.chartPreviousClose;
  // Reject sub-cent priors (1e-8) to avoid `"0.00000000"` slipping through as
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
 * Fetches prices from Yahoo Finance for a list of tickers.
 * Returns a map of ticker → price entry; tickers with no data are omitted.
 * Throws UpstreamUnavailableError on network failure or upstream 5xx/429.
 */
export async function fetchYahooPrices(
  tickers: string[],
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
        const result = await fetchOneTicker(ticker, fetcher);
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
