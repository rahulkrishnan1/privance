import { Decimal, HoldingPayloadSchema, SCALE_CRYPTO } from "@privance/core";
import type { FilterState, LocalHolding, SortState } from "./types";

type PriceEntry = { ticker: string; price: string };

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

function getMarketValue(h: LocalHolding, prices: Map<string, PriceEntry>): Decimal {
  const priceTicker = h.proxyTicker ?? h.ticker;
  const entry = prices.get(priceTicker);
  if (entry === undefined) return Decimal.zero(2);
  try {
    const shares = Decimal.fromString(h.sharesMajor, h.sharesScale);
    const price = Decimal.fromString(entry.price, SCALE_CRYPTO);
    const scale =
      h.scaleFactor !== undefined ? Decimal.fromString(h.scaleFactor, SCALE_CRYPTO) : null;
    const effectivePrice = scale !== null ? price.mul(scale, { resultScale: SCALE_CRYPTO }) : price;
    return shares.mul(effectivePrice, { resultScale: 2 });
  } catch {
    return Decimal.zero(2);
  }
}

function getShares(h: LocalHolding): Decimal {
  try {
    return Decimal.fromString(h.sharesMajor, h.sharesScale);
  } catch {
    return Decimal.zero(h.sharesScale);
  }
}

// Integer cents ("150000" = $1,500.00) — current write path.
const INT_CENTS_RE = /^-?(0|[1-9][0-9]*)$/;
// Dollar-decimal with exactly two places ("1500.00" = $1,500.00) — legacy
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

function getCostBasis(h: LocalHolding): Decimal {
  return parseCostBasisCents(h.costBasisCents);
}

function getAvgCost(h: LocalHolding): Decimal {
  try {
    const cost = getCostBasis(h);
    const shares = Decimal.fromString(h.sharesMajor, h.sharesScale);
    if (shares.isZero()) return Decimal.zero(2);
    return cost.div(shares);
  } catch {
    return Decimal.zero(2);
  }
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
): LocalHolding[] {
  const dir = sort.direction === "asc" ? 1 : -1;

  return [...holdings].sort((a, b) => {
    switch (sort.column) {
      case "ticker":
        return dir * a.ticker.localeCompare(b.ticker);
      case "account":
        return dir * a.accountId.localeCompare(b.accountId);
      case "shares":
        return dir * getShares(a).cmp(getShares(b));
      case "avgCost":
        return dir * getAvgCost(a).cmp(getAvgCost(b));
      case "currentPrice":
        return dir * getPrice(a, prices).cmp(getPrice(b, prices));
      case "marketValue":
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

export function parseStoredHolding(objectId: string, bytes: Uint8Array, updatedAt: number) {
  const p = HoldingPayloadSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  return {
    id: objectId,
    accountId: p.accountId,
    groupId: p.groupId,
    ticker: p.ticker,
    assetType: p.assetType,
    proxyTicker: p.proxyTicker,
    sharesMajor: p.sharesMajor,
    sharesScale: p.sharesScale,
    costBasisCents: p.costBasisCents,
    scaleFactor: p.scaleFactor,
    proxyAnchoredAt: p.proxyAnchoredAt,
    name: p.name,
    updatedAt,
  };
}
