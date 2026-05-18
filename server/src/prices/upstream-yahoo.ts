import type { FetchLike, UpstreamPrice } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

const YAHOO_BASE = "https://query1.finance.yahoo.com";
// Yahoo v8 chart endpoint, one ticker per call; batch via Promise.all.
const YAHOO_CHART_PATH = (ticker: string) =>
  `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;

const FETCH_TIMEOUT_MS = 15_000;

type YahooChartResponse = {
  chart: {
    result: Array<{
      meta?: {
        regularMarketPrice?: number;
        currency?: string;
      };
    }> | null;
    error?: { description?: string } | null;
  };
};

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

  let body: YahooChartResponse;
  try {
    body = (await res.json()) as YahooChartResponse;
  } catch {
    throw new UpstreamUnavailableError("malformed upstream response");
  }

  const result = body?.chart?.result;
  if (!Array.isArray(result) || result.length === 0 || result[0] == null) return null;

  const price = result[0].meta?.regularMarketPrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;

  // Represent price as a fixed-8 decimal string (no floating-point arithmetic on the value).
  const decimal = price.toFixed(8);
  return {
    price: decimal,
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

  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const result = await fetchOneTicker(ticker, fetcher);
        return [ticker, result] as const;
      } catch (err) {
        if (err instanceof UpstreamUnavailableError) {
          // Per-ticker upstream failure isolated to "unknown" — one bad
          // ticker shouldn't fail the whole batch.
          return [ticker, null] as const;
        }
        throw err;
      }
    }),
  );

  const out = new Map<string, UpstreamPrice>();
  for (const [ticker, entry] of entries) {
    if (entry !== null) out.set(ticker, entry);
  }
  return out;
}
