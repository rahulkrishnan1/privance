import { regionFromCountry } from "./_region.js";
import type { AssetType, FetchLike, SymbolProfile } from "./types.js";
import { UpstreamUnavailableError } from "./types.js";

// Yahoo Finance v10 quoteSummary, assetProfile + summaryDetail modules give us
// sector, industry, country, currency and display name in a single call;
// topHoldings adds a fund's sector composition. v10 is the working path; v11
// 404s at the edge.
const YAHOO_BASE = "https://query1.finance.yahoo.com";
// quoteSummary now requires a crumb tied to a session cookie. fc.yahoo.com
// returns that cookie directly (a bare 404 with Set-Cookie, no redirect), so
// fetch doesn't drop it the way it would following a quote-page redirect. We
// then fetch a crumb and cache both for reuse.
const COOKIE_URL = "https://fc.yahoo.com/";
const CRUMB_URL = `${YAHOO_BASE}/v1/test/getcrumb`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function quoteSummaryUrl(ticker: string, crumb: string): string {
  const modules = "assetProfile,summaryDetail,quoteType,fundProfile,topHoldings";
  return `${YAHOO_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}`;
}

const FETCH_TIMEOUT_MS = 15_000;

type YahooAuth = { cookie: string; crumb: string };
let cachedAuth: YahooAuth | null = null;

function extractCookie(res: Response): string {
  const jar =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
  return jar
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

/** Fetch (and cache) a cookie + crumb pair, or null if Yahoo refuses one. */
async function getYahooAuth(fetcher: FetchLike, force = false): Promise<YahooAuth | null> {
  if (cachedAuth !== null && !force) return cachedAuth;
  try {
    const cookieRes = await fetcher(COOKIE_URL, {
      headers: { "User-Agent": UA },
      redirect: "manual",
    });
    const cookie = extractCookie(cookieRes);
    if (cookie === "") return null;
    const crumbRes = await fetcher(CRUMB_URL, {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    // A valid crumb is a short token; an error body ("Too Many Requests") is not.
    if (crumb === "" || crumb.length > 64 || crumb.includes(" ")) return null;
    cachedAuth = { cookie, crumb };
    return cachedAuth;
  } catch {
    return null;
  }
}

/** Test-only: drop the cached cookie + crumb so each test authenticates through
 *  its own injected fetcher rather than inheriting another test's (or a real
 *  network call's) auth, which would make results host-dependent. */
export function __clearYahooAuthCache(): void {
  cachedAuth = null;
}

// Yahoo's topHoldings.sectorWeightings keys are slugs; map them to the same
// display names Yahoo uses for an individual equity's `sector` so fund and stock
// sectors merge into one slice.
const YAHOO_SECTOR_NAMES: Record<string, string> = {
  realestate: "Real Estate",
  consumer_cyclical: "Consumer Cyclical",
  basic_materials: "Basic Materials",
  consumer_defensive: "Consumer Defensive",
  technology: "Technology",
  communication_services: "Communication Services",
  financial_services: "Financial Services",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Healthcare",
};

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
            dividendYield?: { raw?: number } | number;
            yield?: { raw?: number } | number;
          };
          quoteType?: {
            shortName?: string;
            longName?: string;
            quoteType?: string;
            exchange?: string;
          };
          fundProfile?: {
            categoryName?: string;
          };
          topHoldings?: {
            sectorWeightings?: Array<Record<string, { raw?: number } | number>>;
          };
        }>
      | null
      | undefined;
    error?: { description?: string } | null;
  };
};

// Parse Yahoo's [{ technology: 0.27 }, ...] into [{ sector, weight }], dropping
// unknown slugs and non-positive weights. Returns undefined when none survive.
function parseSectorWeightings(
  raw: Array<Record<string, { raw?: number } | number>> | undefined,
): ReadonlyArray<{ sector: string; weight: number }> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: Array<{ sector: string; weight: number }> = [];
  for (const entry of raw) {
    const pair = Object.entries(entry)[0];
    if (pair === undefined) continue;
    const [slug, value] = pair;
    const sector = YAHOO_SECTOR_NAMES[slug];
    const weight = rawNumber(value);
    if (sector === undefined || weight === undefined || weight <= 0) continue;
    out.push({ sector, weight });
  }
  return out.length > 0 ? out : undefined;
}

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

// Yahoo returns numeric fields as `{ raw: number }` objects, occasionally as a
// bare number. Normalise to a number, or undefined if absent.
function rawNumber(value: { raw?: number } | number | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (value != null && typeof value.raw === "number") return value.raw;
  return undefined;
}

const BOND_CATEGORY = /bond|fixed income|treasury|municipal|tips|government|credit/i;
const MONEY_MARKET_CATEGORY = /money market/i;

// Funds (etf / mutual_fund) carry their fixed-income or cash nature in the
// category name rather than the quoteType; refine the class from it.
function refineFundClass(
  assetClass: string | undefined,
  fundCategory: string | undefined,
): string | undefined {
  if (assetClass !== "etf" && assetClass !== "mutual_fund") return assetClass;
  if (fundCategory === undefined) return assetClass;
  if (BOND_CATEGORY.test(fundCategory)) return "fixed_income";
  if (MONEY_MARKET_CATEGORY.test(fundCategory)) return "cash";
  return assetClass;
}

async function fetchOneProfile(
  ticker: string,
  fetcher: FetchLike,
  auth: YahooAuth,
): Promise<SymbolProfile | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    // Generic browser UA: Yahoo 429s no-UA requests as bots. The crumb + cookie
    // authenticate the request; no user IP or user-identifying headers forwarded.
    res = await fetcher(quoteSummaryUrl(ticker, auth.crumb), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        Cookie: auth.cookie,
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    throw new UpstreamUnavailableError(`network error fetching upstream: ${String(err)}`);
  }
  clearTimeout(timeoutId);

  if (res.status === 401 || res.status === 403) {
    // Stale crumb: drop it so the next batch re-authenticates, and treat this as
    // transient rather than a missing ticker.
    cachedAuth = null;
    throw new UpstreamUnavailableError("upstream auth rejected");
  }

  if (res.status === 429 || res.status >= 500) {
    // Mask upstream 429/5xx, do not expose upstream identity to callers.
    throw new UpstreamUnavailableError("upstream returned non-2xx");
  }

  if (!res.ok) {
    // 4xx other than auth/429 → treat as unknown ticker.
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

  const fundCategory = entry.fundProfile?.categoryName ?? undefined;
  // Yield is already a fraction (0.0137 = 1.37%); mutual funds use `yield`.
  const yieldRaw =
    rawNumber(entry.summaryDetail?.dividendYield) ?? rawNumber(entry.summaryDetail?.yield);
  // Fixed-point, never String(): a tiny value would serialize as "1e-7", which the
  // client's plain-decimal yield parser cannot read. 6 dp covers any real yield.
  const dividendYield =
    yieldRaw !== undefined && Number.isFinite(yieldRaw) ? yieldRaw.toFixed(6) : undefined;

  return {
    ticker,
    assetType,
    displayName,
    assetClass: refineFundClass(assetClass, fundCategory),
    sector: entry.assetProfile?.sector ?? undefined,
    sectorWeightings: parseSectorWeightings(entry.topHoldings?.sectorWeightings),
    industry: entry.assetProfile?.industry ?? undefined,
    dividendYield,
    fundCategory,
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

  // One crumb + cookie for the whole batch. quoteSummary 401s without it, so if
  // Yahoo refuses one we degrade to "found nothing" rather than failing the whole
  // lookup; the misses become unknown and the client retries them later.
  const auth = await getYahooAuth(fetcher);
  if (auth === null) return new Map();

  // Bounded concurrency: even a full-size batch must not open one socket per
  // ticker against the upstream. Fetch in fixed-width waves.
  const CONCURRENCY = 8;
  const out = new Map<string, SymbolProfile>();
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const wave = await Promise.all(
      tickers.slice(i, i + CONCURRENCY).map(async (ticker) => {
        try {
          const profile = await fetchOneProfile(ticker, fetcher, auth);
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
    for (const [ticker, profile] of wave) {
      if (profile !== null) out.set(ticker, profile);
    }
  }
  return out;
}
