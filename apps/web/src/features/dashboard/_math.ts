import {
  type computeNetWorth,
  Decimal,
  type Holding,
  type HoldingId,
  SCALE_CENTS,
  SCALE_CRYPTO,
} from "@privance/core";

export type Delta = { dollar: Decimal; pct: number };

type Breakdown = ReturnType<typeof computeNetWorth>;

// Per-holding day change in cents = shares × (price − prevPrice) × scaleFactor.
// Skipped when prior price is missing so the row renders em-dash rather than a
// misleading zero. Sub-cent rounding can drift up to ±1 cent vs `MV_today −
// MV_yesterday` computed independently; harmless for display.
export function computeDayChangeByHoldingId(
  holdings: readonly Holding[],
  prices: ReadonlyMap<string, Decimal>,
  previousPrices: ReadonlyMap<string, Decimal>,
): Map<HoldingId, Decimal> {
  const out = new Map<HoldingId, Decimal>();
  for (const h of holdings) {
    const priceKey = h.payload.proxyTicker ?? h.payload.ticker;
    const cur = prices.get(priceKey);
    const prev = previousPrices.get(priceKey);
    if (cur === undefined || prev === undefined) continue;
    const shares = Decimal.fromString(h.payload.sharesMajor, h.payload.sharesScale);
    const priceDelta = cur.sub(prev);
    const effectiveDelta =
      h.payload.scaleFactor !== undefined
        ? priceDelta.mul(Decimal.fromString(h.payload.scaleFactor, SCALE_CRYPTO), {
            resultScale: SCALE_CRYPTO,
          })
        : priceDelta;
    out.set(h.id, shares.mul(effectiveDelta, { resultScale: SCALE_CENTS }));
  }
  return out;
}

// Investments % uses the SAME subset of holdings that contributed to the
// dollar change as its denominator; mixing in holdings without prior data
// would inflate the denominator and understate the percentage. Net Worth's
// dollar change equals Investments' dollar change (cash, manual assets, and
// liabilities don't move intraday).
export function deriveAggregateDeltas(
  breakdown: Breakdown,
  dayChangeByHoldingId: ReadonlyMap<HoldingId, Decimal>,
): { investments: Delta | null; netWorth: Delta | null } {
  if (dayChangeByHoldingId.size === 0) return { investments: null, netWorth: null };
  let dollar = Decimal.zero(SCALE_CENTS);
  let mvCovered = Decimal.zero(SCALE_CENTS);
  for (const h of breakdown.byHolding) {
    const change = dayChangeByHoldingId.get(h.holdingId);
    if (change === undefined) continue;
    dollar = dollar.add(change);
    mvCovered = mvCovered.add(h.marketValue);
  }
  const prev = mvCovered.sub(dollar);
  if (prev.isZero()) return { investments: null, netWorth: null };

  const investments: Delta = { dollar, pct: dollar.toFloat() / prev.toFloat() };

  const otherKinds = breakdown.netWorth.sub(mvCovered);
  const prevNetWorth = prev.add(otherKinds);
  const netWorth: Delta | null = prevNetWorth.isZero()
    ? null
    : { dollar, pct: dollar.toFloat() / prevNetWorth.toFloat() };

  return { investments, netWorth };
}

// Bucket by what the money *is*, not which account holds it: an investment
// account's cash sweep belongs in Cash, holdings market value is what's in
// Investments. Single source of truth for the Composition pie and KPI tiles.
export function splitCashAndInvestments(breakdown: Breakdown): {
  cash: Decimal;
  investments: Decimal;
} {
  const investments = breakdown.byHolding.reduce(
    (acc, h) => acc.add(h.marketValue),
    Decimal.zero(SCALE_CENTS),
  );
  const investmentAccountCash = breakdown.byAccountKind.investment.sub(investments);
  const cash = breakdown.byAccountKind.cash.add(investmentAccountCash);
  return { cash, investments };
}
