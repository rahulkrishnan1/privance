import { Decimal, SCALE_CENTS, SCALE_CRYPTO } from "@privance/core";
import type { RefreshPricesResponse } from "@/lib/api/prices";
import { getMarketValue } from "@/lib/market-value";
import type { FilterState, LocalHolding, SortState } from "./types";

type PriceEntry = { ticker: string; price: string };

/** A copy of `items` ordered by descending value, ties broken by name (ascending). */
export function sortByValueDesc<T>(
  items: readonly T[],
  getValue: (item: T) => Decimal,
  getName: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const byValue = getValue(b).cmp(getValue(a));
    return byValue !== 0 ? byValue : getName(a).localeCompare(getName(b));
  });
}

export function computeEffectivePrice(priceStr: string, scaleFactor?: string): Decimal | null {
  try {
    const p = Decimal.fromString(priceStr, SCALE_CRYPTO);
    if (scaleFactor === undefined) return p;
    const sf = Decimal.fromString(scaleFactor, SCALE_CRYPTO);
    return p.mul(sf, { resultScale: SCALE_CRYPTO });
  } catch {
    return null;
  }
}

export function computeMarketValue(
  sharesMajor: string,
  sharesScale: number,
  priceStr: string,
  scaleFactor?: string,
): Decimal | null {
  try {
    const shares = Decimal.fromString(sharesMajor, sharesScale);
    const price = Decimal.fromString(priceStr, SCALE_CRYPTO);
    const scale = scaleFactor ? Decimal.fromString(scaleFactor, SCALE_CRYPTO) : null;
    const effectivePrice = scale !== null ? price.mul(scale, { resultScale: SCALE_CRYPTO }) : price;
    return shares.mul(effectivePrice, { resultScale: SCALE_CENTS });
  } catch {
    return null;
  }
}

// Crypto holdings store the lowercase CoinGecko id as their ticker and have no
// upstream profile; title-case it ("avalanche-2" -> "Avalanche 2") so the row
// still has a readable name beneath the ticker.
export function humanizeCryptoId(id: string): string {
  return id
    .split("-")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function filterHoldings(holdings: LocalHolding[], filter: FilterState): LocalHolding[] {
  switch (filter.kind) {
    case "all":
      return holdings;
    case "account":
      return holdings.filter((h) => h.accountId === filter.accountId);
    case "group":
      return holdings.filter((h) => h.groupId === filter.groupId);
  }
}

// Integer cents ("150000" = $1,500.00), current write path.
const INT_CENTS_RE = /^-?(0|[1-9][0-9]*)$/;
// Dollar-decimal with exactly two places ("1500.00" = $1,500.00), legacy
// records still on disk in some local DBs.
const DOLLAR_DECIMAL_RE = /^-?(0|[1-9][0-9]*)\.[0-9]{2}$/;

export function parseCostBasisCents(costBasisCents: string): Decimal {
  if (DOLLAR_DECIMAL_RE.test(costBasisCents)) {
    return Decimal.fromString(costBasisCents, 2);
  }
  if (INT_CENTS_RE.test(costBasisCents)) {
    return Decimal.fromMinorUnits(BigInt(costBasisCents), 2);
  }
  throw new Error(`invalid costBasisCents: ${costBasisCents}`);
}

/**
 * Anchor scale factor for a proxy holding from the user-supplied current
 * price per share (V1's NAV) and the current proxy price.
 *
 * Throws on bad inputs so the caller can surface a form error rather than
 * silently writing an undefined scale factor.
 */
export function computeAnchorScaleFactor(navStr: string, proxyPriceStr: string): string {
  const nav = Decimal.fromString(navStr.trim(), SCALE_CRYPTO);
  const proxyPrice = Decimal.fromString(proxyPriceStr, SCALE_CRYPTO);
  if (nav.isZero() || proxyPrice.isZero()) {
    throw new Error("Current price and proxy price must both be greater than zero.");
  }
  return nav.div(proxyPrice).toString();
}

/**
 * Anchor metadata is only valid with a proxy ticker. `updateHolding` merges a
 * partial patch, which can't express "delete a field", so dropping the proxy
 * would leave a stale `scaleFactor` that multiplies the real ticker price.
 */
export function clearStaleProxyAnchor<
  T extends { proxyTicker: string | null; scaleFactor?: string; proxyAnchoredAt?: string },
>(payload: T): T {
  if (payload.proxyTicker !== null) return payload;
  const cleaned = { ...payload };
  delete cleaned.scaleFactor;
  delete cleaned.proxyAnchoredAt;
  return cleaned;
}

export async function lookupProxyPrice(
  ticker: string,
  cachedPrice: string | undefined,
  refresh: (tickers: string[]) => Promise<RefreshPricesResponse>,
  warm: (ticker: string, price: Decimal) => void,
): Promise<string | null> {
  if (cachedPrice !== undefined) return cachedPrice;
  try {
    const response = await refresh([ticker]);
    const entry = response.prices.find((p) => p.ticker === ticker);
    if (entry === undefined) return null;
    warm(ticker, Decimal.fromString(entry.price, 8));
    return entry.price;
  } catch {
    return null;
  }
}

function getCostBasis(h: LocalHolding): Decimal {
  return parseCostBasisCents(h.costBasisCents);
}

function getPrice(h: LocalHolding, prices: Map<string, PriceEntry>): Decimal {
  const priceTicker = h.proxyTicker ?? h.ticker;
  const entry = prices.get(priceTicker);
  if (entry === undefined) return Decimal.zero(SCALE_CRYPTO);
  try {
    const price = Decimal.fromString(entry.price, SCALE_CRYPTO);
    const scale =
      h.scaleFactor !== undefined ? Decimal.fromString(h.scaleFactor, SCALE_CRYPTO) : null;
    return scale !== null ? price.mul(scale, { resultScale: SCALE_CRYPTO }) : price;
  } catch {
    return Decimal.zero(SCALE_CRYPTO);
  }
}

function getGainDollar(h: LocalHolding, prices: Map<string, PriceEntry>): Decimal {
  return getMarketValue(h, prices).sub(getCostBasis(h));
}

function getGainPct(h: LocalHolding, prices: Map<string, PriceEntry>): number {
  const cost = getCostBasis(h);
  if (cost.isZero()) return 0;
  const gain = getMarketValue(h, prices).sub(cost);
  // Decimal.div on different-scale operands rounds; use float for sort-only comparison.
  return gain.toFloat() / cost.toFloat();
}

export function sortHoldings(
  holdings: LocalHolding[],
  sort: SortState,
  prices: Map<string, PriceEntry>,
  dayChangeByHoldingId: ReadonlyMap<string, Decimal> = new Map(),
): LocalHolding[] {
  const dir = sort.direction === "asc" ? 1 : -1;

  return [...holdings].sort((a, b) => {
    switch (sort.column) {
      case "ticker":
        return dir * a.ticker.localeCompare(b.ticker);
      case "currentPrice":
        return dir * getPrice(a, prices).cmp(getPrice(b, prices));
      case "dayPct": {
        // Sort by absolute day-change amount; null (no price) sorts last.
        const da = dayChangeByHoldingId.get(a.id) ?? null;
        const db = dayChangeByHoldingId.get(b.id) ?? null;
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return dir * da.cmp(db);
      }
      case "marketValue":
      case "weight":
        return dir * getMarketValue(a, prices).cmp(getMarketValue(b, prices));
      case "gainDollar":
        return dir * getGainDollar(a, prices).cmp(getGainDollar(b, prices));
      case "gainPct": {
        const pa = getGainPct(a, prices);
        const pb = getGainPct(b, prices);
        return dir * (pa < pb ? -1 : pa > pb ? 1 : 0);
      }
      default:
        return 0;
    }
  });
}
