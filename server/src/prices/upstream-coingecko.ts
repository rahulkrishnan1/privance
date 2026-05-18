import type { FetchLike, UpstreamPrice } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

const COINGECKO_BASE = "https://api.coingecko.com";
// CoinGecko simple/price — IDs comma-separated, vs_currencies=usd
const COINGECKO_PRICE_URL = (ids: string) =>
  `${COINGECKO_BASE}/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;

const FETCH_TIMEOUT_MS = 15_000;

type CoinGeckoResponse = Record<string, { usd?: number }>;

/**
 * Fetches prices from CoinGecko simple/price endpoint for a list of coin IDs.
 * Returns a map of id → price entry; IDs with no data are omitted.
 * Throws UpstreamUnavailableError on network failure or upstream 5xx/429.
 */
export async function fetchCoinGeckoPrices(
  ids: string[],
  fetcher: FetchLike = globalThis.fetch,
): Promise<Map<string, UpstreamPrice>> {
  if (ids.length === 0) return new Map();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    // The server proxies the call so the user's IP never reaches the upstream.
    // CoinGecko's free tier accepts unauthenticated requests without a UA.
    res = await fetcher(COINGECKO_PRICE_URL(ids.join(",")), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw new UpstreamUnavailableError(`network error: ${String(err)}`);
  }
  clearTimeout(timeoutId);

  if (res.status === 429 || res.status >= 500) {
    // Don't expose the upstream's status to callers; surface a generic
    // unavailable so we don't leak which provider we use.
    throw new UpstreamUnavailableError(`upstream returned ${res.status}`);
  }

  if (!res.ok) {
    return new Map();
  }

  let body: CoinGeckoResponse;
  try {
    body = (await res.json()) as CoinGeckoResponse;
  } catch {
    throw new UpstreamUnavailableError("malformed JSON from upstream");
  }

  const now = new Date().toISOString();
  const out = new Map<string, UpstreamPrice>();

  for (const id of ids) {
    const entry = body[id];
    if (!entry) continue;
    const price = entry.usd;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    // Represent price as a fixed-8 decimal string (no floating-point arithmetic on the value).
    const decimal = price.toFixed(8);
    out.set(id, { price: decimal, fetchedAt: now });
  }

  return out;
}
