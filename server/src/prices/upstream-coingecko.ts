import type { FetchLike, UpstreamPrice } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

const COINGECKO_BASE = "https://api.coingecko.com";
// CoinGecko simple/price — IDs comma-separated. include_24hr_change adds a
// `usd_24h_change` percent field used to derive the prior session price.
const COINGECKO_PRICE_URL = (ids: string) =>
  `${COINGECKO_BASE}/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;

const FETCH_TIMEOUT_MS = 15_000;

type CoinGeckoResponse = Record<string, { usd?: number; usd_24h_change?: number }>;

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
    // Represent prices as fixed-8 decimal strings (no floating-point arithmetic on the value).
    const decimal = price.toFixed(8);

    // CoinGecko gives 24h % change (rolling, not session-based, since crypto
    // trades 24/7). Derive the 24h-ago price as `current / (1 + change/100)`.
    // -100% would imply zero prior; reject sub-cent priors too so the rounded
    // string can't be "0.00000000" (downstream divide-by-zero hazard).
    const changePct = entry.usd_24h_change;
    let previousPrice: string | null = null;
    if (typeof changePct === "number" && Number.isFinite(changePct) && changePct > -100) {
      const prior = price / (1 + changePct / 100);
      if (Number.isFinite(prior) && prior >= 1e-8) {
        previousPrice = prior.toFixed(8);
      }
    }

    out.set(id, { price: decimal, previousPrice, fetchedAt: now });
  }

  return out;
}
