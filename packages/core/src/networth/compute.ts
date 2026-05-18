import { Decimal, SCALE_CENTS, SCALE_CRYPTO } from "../decimal/index.js";
import type { Holding } from "../domain/index.js";
import type {
  AccountValuation,
  HoldingValuation,
  NetWorthBreakdown,
  NetWorthInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Integer cents ("2500000" = $25,000.00) — account balances.
const INT_CENTS_RE = /^-?(0|[1-9][0-9]*)$/;
// Dollar-decimal with exactly two places ("1500.00" = $1,500.00) — holding cost basis.
const DOLLAR_DECIMAL_RE = /^-?(0|[1-9][0-9]*)\.[0-9]{2}$/;

function parseCents(s: string): Decimal {
  if (DOLLAR_DECIMAL_RE.test(s)) {
    return Decimal.fromString(s, SCALE_CENTS);
  }
  if (INT_CENTS_RE.test(s)) {
    return Decimal.fromMinorUnits(BigInt(s), SCALE_CENTS);
  }
  throw new Error(`invalid cents string: ${s}`);
}

/**
 * Compute market value for one holding.
 *
 * Resolution order:
 * 1. If proxyTicker + scaleFactor are set, use proxy price × scaleFactor × shares.
 * 2. Otherwise use primary ticker price × shares.
 * 3. If the relevant ticker is missing → returns null (caller records unknown).
 */
function holdingMarketValue(
  holding: Holding,
  prices: Map<string, Decimal>,
): { value: Decimal; unknownTicker: string | null } {
  const { ticker, proxyTicker, sharesMajor, sharesScale, scaleFactor } = holding.payload;

  const shares = Decimal.fromString(sharesMajor, sharesScale);

  if (proxyTicker !== null) {
    const proxyPrice = prices.get(proxyTicker);
    if (proxyPrice === undefined) {
      return { value: Decimal.zero(SCALE_CENTS), unknownTicker: proxyTicker };
    }
    // scaleFactor is dimensionless. Parse at SCALE_CRYPTO (8dp) so user-supplied
    // values like "0.98765" don't trigger ParseError when the price scale is smaller.
    const sf =
      scaleFactor !== undefined
        ? Decimal.fromString(scaleFactor, SCALE_CRYPTO)
        : Decimal.fromString("1", SCALE_CRYPTO);
    // Keep the intermediate effective price at full crypto precision; only round
    // to cents at the very end. Rounding effectivePrice to cents BEFORE the shares
    // multiplication zeroed out low-priced or fractional-share proxy holdings.
    const effectivePrice = proxyPrice.mul(sf, { resultScale: SCALE_CRYPTO });
    const centsValue = effectivePrice.mul(shares, { resultScale: SCALE_CENTS });
    return { value: centsValue, unknownTicker: null };
  }

  const price = prices.get(ticker);
  if (price === undefined) {
    return { value: Decimal.zero(SCALE_CENTS), unknownTicker: ticker };
  }

  // price × shares → result at SCALE_CENTS.
  // The Decimal.mul resultScale machinery handles the unit conversion:
  // price is major-units (scale=2 → cents internally), shares is unitless,
  // multiplying and reducing to SCALE_CENTS gives the correct cent value.
  const centsValue = price.mul(shares, { resultScale: SCALE_CENTS });
  return { value: centsValue, unknownTicker: null };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a full net-worth breakdown from decrypted in-memory objects.
 * Pure function, no I/O, no side effects.
 */
export function computeNetWorth(input: NetWorthInput): NetWorthBreakdown {
  const { accounts, holdings, prices } = input;

  const unknownTickersSet = new Set<string>();

  // ---- Determine primary currency: mode across all accounts with a currency.
  // On tie, pick the lexicographically smallest code for determinism regardless
  // of account order.
  let primaryCurrency: string | null = null;
  {
    const freq = new Map<string, number>();
    for (const acct of accounts) {
      const c = acct.payload.currency;
      if (c !== undefined) freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    let bestCount = 0;
    for (const [c, count] of freq) {
      if (
        count > bestCount ||
        (count === bestCount && primaryCurrency !== null && c < primaryCurrency)
      ) {
        primaryCurrency = c;
        bestCount = count;
      }
    }
  }

  // ---- Accumulate per-account values ----------------------------------------
  let cashTotal = Decimal.zero(SCALE_CENTS);
  let investmentTotal = Decimal.zero(SCALE_CENTS);
  let liabilityTotal = Decimal.zero(SCALE_CENTS);
  let manualAssetTotal = Decimal.zero(SCALE_CENTS);

  const byAccount: AccountValuation[] = [];

  for (const acct of accounts) {
    const currency = acct.payload.currency;
    if (primaryCurrency !== null && currency !== undefined && currency !== primaryCurrency) {
      unknownTickersSet.add(`currency_mismatch:${acct.id}`);
    }

    switch (acct.payload.kind) {
      case "cash": {
        const balance = parseCents(acct.payload.balanceCents);
        cashTotal = cashTotal.add(balance);
        byAccount.push({ accountId: acct.id, value: balance, kind: "cash" });
        break;
      }
      case "investment": {
        // Initial value = cash sweep; holding market values are added below.
        const cashSweep = parseCents(acct.payload.cashBalanceCents);
        byAccount.push({ accountId: acct.id, value: cashSweep, kind: "investment" });
        investmentTotal = investmentTotal.add(cashSweep);
        break;
      }
      case "liability": {
        const balance = parseCents(acct.payload.balanceCents);
        liabilityTotal = liabilityTotal.add(balance);
        byAccount.push({ accountId: acct.id, value: balance, kind: "liability" });
        break;
      }
      case "manual_asset": {
        const value = parseCents(acct.payload.valueCents);
        manualAssetTotal = manualAssetTotal.add(value);
        byAccount.push({ accountId: acct.id, value, kind: "manual_asset" });
        break;
      }
    }
  }

  // ---- Process holdings, accumulate market value per investment account ----
  // accountId → byAccount index for O(1) lookups when attaching holding values.
  const investmentAccountIndexByAccountId = new Map<string, number>();
  for (let i = 0; i < byAccount.length; i++) {
    const entry = byAccount[i];
    if (entry !== undefined && entry.kind === "investment") {
      investmentAccountIndexByAccountId.set(entry.accountId, i);
    }
  }

  const byHolding: HoldingValuation[] = [];

  for (const holding of holdings) {
    const costBasis = parseCents(holding.payload.costBasisCents);
    const { value: marketValue, unknownTicker } = holdingMarketValue(holding, prices);

    if (unknownTicker !== null) {
      unknownTickersSet.add(unknownTicker);
    }

    const unrealizedPnl = marketValue.sub(costBasis);
    byHolding.push({ holdingId: holding.id, marketValue, costBasis, unrealizedPnl });

    // Accumulate market value onto the parent account entry.
    const idx = investmentAccountIndexByAccountId.get(holding.payload.accountId);
    if (idx !== undefined) {
      const existing = byAccount[idx];
      if (existing !== undefined) {
        byAccount[idx] = {
          accountId: existing.accountId,
          value: existing.value.add(marketValue),
          kind: existing.kind,
        };
      }
    }

    investmentTotal = investmentTotal.add(marketValue);
  }

  const totalAssets = cashTotal.add(investmentTotal).add(manualAssetTotal);
  const netWorth = totalAssets.sub(liabilityTotal);

  return {
    totalAssets,
    totalLiabilities: liabilityTotal,
    netWorth,
    byAccountKind: {
      cash: cashTotal,
      investment: investmentTotal,
      liability: liabilityTotal,
      manualAsset: manualAssetTotal,
    },
    byAccount,
    byHolding,
    unknownTickers: [...unknownTickersSet],
    asOf: Date.now(),
  };
}

// Exported for use by allocation.ts
export { holdingMarketValue, parseCents };
