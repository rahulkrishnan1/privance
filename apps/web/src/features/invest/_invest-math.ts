import type {
  Account,
  AllocationSlice,
  Holding,
  HoldingId,
  NetWorthBreakdown,
} from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";
import type { SymbolProfileEntry } from "@/lib/api/symbol-profiles";
import { TAX_TREATMENT_BY_SUBKIND, TAX_TREATMENT_LABEL } from "./_constants";
import type { EstimatedIncomeResult, IncomePayer, TaxBucket, TaxBucketsResult } from "./types";

export type { EstimatedIncomeResult, IncomePayer, TaxBucket, TaxBucketsResult };

/**
 * Sum unrealizedPnl across all holdings in the breakdown.
 * pct = sum(unrealizedPnl) / sum(costBasis), 0 when costBasis is zero.
 */
export function portfolioGain(breakdown: NetWorthBreakdown): {
  gainCents: Decimal;
  gainPct: number;
} {
  return subsetGain(breakdown.byHolding);
}

/**
 * Gain for a subset of HoldingValuation entries.
 * gainPct = sum(unrealizedPnl) / sum(costBasis), 0 when costBasis is zero.
 */
export function subsetGain(valuations: NetWorthBreakdown["byHolding"]): {
  gainCents: Decimal;
  gainPct: number;
} {
  let totalGain = Decimal.zero(SCALE_CENTS);
  let totalCost = Decimal.zero(SCALE_CENTS);

  for (const h of valuations) {
    totalGain = totalGain.add(h.unrealizedPnl);
    totalCost = totalCost.add(h.costBasis);
  }

  const gainPct = totalCost.isZero() ? 0 : totalGain.toFloat() / totalCost.toFloat();

  return { gainCents: totalGain, gainPct };
}

/**
 * Bucket each account's value by tax treatment.
 *
 * Investment accounts are valued via breakdown.byAccount (already includes cash sweep).
 * Cash bucket = cash accounts only (investment account value already includes sweep in breakdown,
 * so we do not double-count the sweep by putting it in Cash).
 * Property = manual_asset accounts. Liabilities are excluded.
 */
export function taxBuckets({
  accounts,
  breakdown,
}: {
  accounts: Account[];
  breakdown: NetWorthBreakdown;
}): TaxBucketsResult {
  const accountValueMap = new Map<string, Decimal>();
  for (const av of breakdown.byAccount) {
    accountValueMap.set(av.accountId, av.value);
  }

  type BucketKey = keyof typeof totals;
  const totals = {
    taxable: Decimal.zero(SCALE_CENTS),
    pretax: Decimal.zero(SCALE_CENTS),
    roth: Decimal.zero(SCALE_CENTS),
    hsa: Decimal.zero(SCALE_CENTS),
    college: Decimal.zero(SCALE_CENTS),
    cash: Decimal.zero(SCALE_CENTS),
    property: Decimal.zero(SCALE_CENTS),
  };

  for (const account of accounts) {
    const value = accountValueMap.get(account.id) ?? Decimal.zero(SCALE_CENTS);
    if (value.isNegative()) continue;

    switch (account.payload.kind) {
      case "investment": {
        const subKind = account.payload.subKind;
        const treatment = TAX_TREATMENT_BY_SUBKIND[subKind] ?? "taxable";
        if (treatment === "taxable") {
          // Split the cash sweep into the Cash bucket so it shows as freely
          // reachable cash rather than as invested taxable assets.
          const rawSweep = Decimal.fromMinorUnits(
            BigInt(account.payload.cashBalanceCents ?? "0"),
            SCALE_CENTS,
          );
          // Clamp: sweep cannot exceed the account value or be negative.
          const sweep =
            rawSweep.isNegative() || rawSweep.isZero()
              ? Decimal.zero(SCALE_CENTS)
              : rawSweep.cmp(value) > 0
                ? value
                : rawSweep;
          totals.taxable = totals.taxable.add(value.sub(sweep));
          totals.cash = totals.cash.add(sweep);
        } else {
          totals[treatment] = totals[treatment].add(value);
        }
        break;
      }
      case "cash":
        totals.cash = totals.cash.add(value);
        break;
      case "manual_asset":
        totals.property = totals.property.add(value);
        break;
      case "liability":
        // Liabilities excluded from the tax-bucket view.
        break;
    }
  }

  const ALL_KEYS: BucketKey[] = ["taxable", "pretax", "roth", "hsa", "college", "cash", "property"];

  const labelFor = (key: BucketKey): string => {
    if (key === "cash") return "Cash";
    if (key === "property") return "Property";
    return TAX_TREATMENT_LABEL[key as keyof typeof TAX_TREATMENT_LABEL];
  };

  // Sorted desc so the panel can color by index from the shared palette
  // (brightest tone anchors the largest bucket), matching the allocation donut.
  const buckets: TaxBucket[] = ALL_KEYS.filter((key) => !totals[key].isZero())
    .map((key) => ({
      key,
      label: labelFor(key),
      valueCents: totals[key],
    }))
    .sort((a, b) => b.valueCents.cmp(a.valueCents));

  const reachableBeforeFiftyNineHalfCents = totals.taxable.add(totals.cash);

  return { buckets, reachableBeforeFiftyNineHalfCents };
}

/** Resolve a holding's profile via its display ticker, falling back to proxy. */
function profileFor(
  holding: Holding,
  profilesByTicker: ReadonlyMap<string, SymbolProfileEntry>,
): SymbolProfileEntry | undefined {
  return (
    profilesByTicker.get(holding.payload.ticker) ??
    (holding.payload.proxyTicker !== null
      ? profilesByTicker.get(holding.payload.proxyTicker)
      : undefined)
  );
}

/** Sum a label→value map into AllocationSlice[], dropping non-positive, sorted desc. */
function slicesFromTotals(totals: Map<string, Decimal>): AllocationSlice[] {
  let total = Decimal.zero(SCALE_CENTS);
  for (const value of totals.values()) {
    if (value.isNegative() || value.isZero()) continue;
    total = total.add(value);
  }

  return [...totals.entries()]
    .filter(([, value]) => !value.isZero() && !value.isNegative())
    .map(([label, value]) => ({
      label,
      value,
      share: total.isZero() ? 0 : value.toFloat() / total.toFloat(),
    }))
    .sort((a, b) => b.value.cmp(a.value));
}

/**
 * Allocation by asset class: Equities, Fixed income, Crypto, Cash.
 *
 * This is the invested-plus-cash mix, so manual assets (property) are excluded;
 * they appear in the net-worth-oriented "Where it lives" view instead. Holdings
 * are bucketed by asset type + profile assetClass; crypto and bond holdings
 * break out of Equities. Cash = cash accounts + investment-account cash sweep +
 * any cash-classed holding.
 */
export function buildClassSlices({
  breakdown,
  holdings,
  profilesByTicker,
}: {
  breakdown: NetWorthBreakdown;
  holdings: Holding[];
  profilesByTicker: ReadonlyMap<string, SymbolProfileEntry>;
}): AllocationSlice[] {
  const holdingById = new Map<HoldingId, Holding>(holdings.map((h) => [h.id, h]));

  let equities = Decimal.zero(SCALE_CENTS);
  let fixedIncome = Decimal.zero(SCALE_CENTS);
  let crypto = Decimal.zero(SCALE_CENTS);
  let holdingCash = Decimal.zero(SCALE_CENTS);
  let holdingsTotal = Decimal.zero(SCALE_CENTS);

  for (const valuation of breakdown.byHolding) {
    holdingsTotal = holdingsTotal.add(valuation.marketValue);
    const holding = holdingById.get(valuation.holdingId);
    if (holding === undefined) {
      equities = equities.add(valuation.marketValue);
      continue;
    }
    const assetClass = profileFor(holding, profilesByTicker)?.assetClass;
    if (holding.payload.assetType === "crypto") {
      crypto = crypto.add(valuation.marketValue);
    } else if (assetClass === "fixed_income") {
      fixedIncome = fixedIncome.add(valuation.marketValue);
    } else if (assetClass === "cash") {
      holdingCash = holdingCash.add(valuation.marketValue);
    } else {
      equities = equities.add(valuation.marketValue);
    }
  }

  // Investment-account cash sweep = total investment value minus holdings at market.
  const cashSweep = breakdown.byAccountKind.investment.sub(holdingsTotal);
  const cash = breakdown.byAccountKind.cash.add(cashSweep).add(holdingCash);

  const totals = new Map<string, Decimal>([
    ["Equities", equities],
    ["Fixed income", fixedIncome],
    ["Crypto", crypto],
    ["Cash", cash],
  ]);

  return slicesFromTotals(totals);
}

/** A fund weight (fraction in [0,1]) as a Decimal for value distribution. */
function weightToDecimal(weight: number): Decimal {
  return Decimal.fromString(weight.toFixed(6), 6);
}

/**
 * Allocation by sector: individual stocks by their GICS sector, funds split
 * across their sector weightings, with crypto and bond holdings broken out and
 * anything without sector data grouped as "Other equities". Cash and property
 * are not part of the sector view.
 */
export function buildSectorSlices({
  breakdown,
  holdings,
  profilesByTicker,
}: {
  breakdown: NetWorthBreakdown;
  holdings: Holding[];
  profilesByTicker: ReadonlyMap<string, SymbolProfileEntry>;
}): AllocationSlice[] {
  const holdingById = new Map<HoldingId, Holding>(holdings.map((h) => [h.id, h]));
  const totals = new Map<string, Decimal>();

  const add = (label: string, value: Decimal) => {
    totals.set(label, (totals.get(label) ?? Decimal.zero(SCALE_CENTS)).add(value));
  };

  for (const valuation of breakdown.byHolding) {
    const holding = holdingById.get(valuation.holdingId);
    if (holding === undefined) {
      add("Other equities", valuation.marketValue);
      continue;
    }
    const profile = profileFor(holding, profilesByTicker);
    const weightings = profile?.sectorWeightings;
    if (holding.payload.assetType === "crypto") {
      add("Crypto", valuation.marketValue);
    } else if (profile?.assetClass === "fixed_income") {
      add("Fixed income", valuation.marketValue);
    } else if (weightings !== undefined && weightings.length > 0) {
      // Funds: split the holding's value across its sector weightings.
      for (const { sector, weight } of weightings) {
        add(
          sector,
          valuation.marketValue.mul(weightToDecimal(weight), { resultScale: SCALE_CENTS }),
        );
      }
    } else if (profile?.sector !== undefined && profile.sector !== "") {
      add(profile.sector, valuation.marketValue);
    } else {
      add("Other equities", valuation.marketValue);
    }
  }

  return slicesFromTotals(totals);
}

/** Parse a yield decimal string ("0.0137") into a Decimal at its own precision. */
function yieldDecimal(yieldStr: string): Decimal {
  const dotIndex = yieldStr.indexOf(".");
  const places = dotIndex === -1 ? 0 : yieldStr.length - dotIndex - 1;
  return Decimal.fromString(yieldStr, places);
}

/**
 * Forward annual income across the cash-plus-invested base:
 *   - dividends: marketValue * dividendYield for each holding with a yield
 *     (proxied holdings roll into their proxy's payer row), and
 *   - interest: balance * APY for each cash account and investment cash sweep
 *     that carries an APY.
 *
 * portfolioYield is the blended yield over that whole base (holdings at market
 * + all cash, whether or not it earns), so idle cash correctly drags it down.
 * annualCents and monthlyCents stay in Decimal; portfolioYield and per-payer
 * yield are display ratios (number). Payers are sorted desc by annualCents.
 */
export function estimatedIncome({
  breakdown,
  accounts = [],
  holdings,
  profilesByTicker,
}: {
  breakdown: NetWorthBreakdown;
  accounts?: Account[];
  holdings: Holding[];
  profilesByTicker: ReadonlyMap<string, SymbolProfileEntry>;
}): EstimatedIncomeResult {
  const holdingById = new Map<HoldingId, Holding>(holdings.map((h) => [h.id, h]));

  let annualCents = Decimal.zero(SCALE_CENTS);
  let totalMarketValue = Decimal.zero(SCALE_CENTS);
  // Aggregate by price ticker (the proxy when present) so a proxied holding
  // rolls into its proxy's payer row instead of showing as a separate name.
  const byTicker = new Map<
    string,
    { ticker: string; annualCents: Decimal; marketValue: Decimal }
  >();

  for (const valuation of breakdown.byHolding) {
    totalMarketValue = totalMarketValue.add(valuation.marketValue);

    const holding = holdingById.get(valuation.holdingId);
    if (holding === undefined) continue;
    const profile = profileFor(holding, profilesByTicker);
    const yieldStr = profile?.dividendYield;
    if (yieldStr === undefined) continue;

    const ratio = Number.parseFloat(yieldStr);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;

    const holdingAnnualCents = valuation.marketValue.mul(yieldDecimal(yieldStr), {
      resultScale: SCALE_CENTS,
    });
    annualCents = annualCents.add(holdingAnnualCents);

    const priceTicker = holding.payload.proxyTicker ?? holding.payload.ticker;
    const existing = byTicker.get(priceTicker);
    if (existing !== undefined) {
      existing.annualCents = existing.annualCents.add(holdingAnnualCents);
      existing.marketValue = existing.marketValue.add(valuation.marketValue);
    } else {
      byTicker.set(priceTicker, {
        ticker: priceTicker,
        annualCents: holdingAnnualCents,
        marketValue: valuation.marketValue,
      });
    }
  }

  const dividendPayers: IncomePayer[] = [...byTicker.values()].map((p) => ({
    id: p.ticker,
    ticker: p.ticker,
    annualCents: p.annualCents,
    yield: p.marketValue.isZero() ? 0 : p.annualCents.toFloat() / p.marketValue.toFloat(),
  }));

  // Interest income from cash accounts and investment cash sweeps. Every
  // positive cash balance joins the yield denominator; only those with an APY
  // contribute income and a payer row.
  let cashBaseCents = Decimal.zero(SCALE_CENTS);
  const interestPayers: IncomePayer[] = [];
  for (const account of accounts) {
    const p = account.payload;
    const balanceStr =
      p.kind === "cash" ? p.balanceCents : p.kind === "investment" ? p.cashBalanceCents : null;
    if (balanceStr === null) continue;

    const balance = Decimal.fromMinorUnits(BigInt(balanceStr), SCALE_CENTS);
    if (balance.isNegative() || balance.isZero()) continue;
    cashBaseCents = cashBaseCents.add(balance);

    const apyStr = p.kind === "cash" || p.kind === "investment" ? p.apy : undefined;
    if (apyStr === undefined) continue;
    const apyRatio = Number.parseFloat(apyStr);
    if (!Number.isFinite(apyRatio) || apyRatio <= 0) continue;

    const interestCents = balance.mul(yieldDecimal(apyStr), { resultScale: SCALE_CENTS });
    annualCents = annualCents.add(interestCents);
    interestPayers.push({
      id: `cash:${account.id}`,
      ticker: "CASH",
      annualCents: interestCents,
      yield: apyRatio,
    });
  }

  const payers: IncomePayer[] = [...dividendPayers, ...interestPayers].sort((a, b) =>
    b.annualCents.cmp(a.annualCents),
  );

  // Blended yield over holdings at market + all cash considered.
  const yieldBase = totalMarketValue.add(cashBaseCents);
  const portfolioYield = yieldBase.isZero() ? 0 : annualCents.toFloat() / yieldBase.toFloat();
  const monthlyCents = annualCents.div(Decimal.fromMinorUnits(12n, 0));

  return { annualCents, portfolioYield, monthlyCents, payers };
}
