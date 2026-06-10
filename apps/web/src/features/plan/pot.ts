import type { Account, Holding } from "@privance/core";
import { CURRENCY_MISMATCH_PREFIX, computeNetWorth, Decimal, SCALE_CENTS } from "@privance/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summary of a non-primary-currency account excluded from the pot. */
export interface ExcludedAccount {
  readonly name: string;
  readonly currency: string;
}

/**
 * Result of deriving the liquid pot.
 *
 * - potCents: sum of cash + investment accounts in the primary currency.
 * - excludedAccounts: cash/investment accounts excluded because their currency
 *   is not primary (listed in the UI disclosure, R19).
 * - manualAssetsCents: total manual asset value (shown as context; not in pot).
 * - liabilitiesCents: total liabilities (shown as context; not in pot).
 * - primaryCurrency: the mode currency across all accounts; null when empty.
 */
export interface PotResult {
  readonly potCents: Decimal;
  readonly excludedAccounts: readonly ExcludedAccount[];
  readonly manualAssetsCents: Decimal;
  readonly liabilitiesCents: Decimal;
  readonly primaryCurrency: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive the liquid pot for FIRE projection inputs.
 *
 * Liquid pot = cash accounts + investment accounts (cash balance + holdings at
 * market value), restricted to the primary currency. manual_asset and
 * liability accounts never enter the pot; they are returned as context values.
 *
 * Valuation, primary-currency selection, and the mismatch signal all come from
 * computeNetWorth (single source of truth); only the per-account exclusion is
 * implemented here, because computeNetWorth sums all currencies and merely
 * flags mismatches.
 *
 * Pure function over already-loaded domain objects; no I/O.
 */
export function deriveLiquidPot(opts: {
  accounts: Account[];
  holdings: Holding[];
  /** Market prices keyed by ticker; required to value holdings. */
  prices: Map<string, Decimal>;
}): PotResult {
  const { accounts, holdings, prices } = opts;
  const breakdown = computeNetWorth({ accounts, holdings, prices });

  const mismatchIds = new Set(
    breakdown.unknownTickers
      .filter((t) => t.startsWith(CURRENCY_MISMATCH_PREFIX))
      .map((t) => t.slice(CURRENCY_MISMATCH_PREFIX.length)),
  );
  const accountById = new Map(accounts.map((a) => [a.id as string, a]));

  let potCents = Decimal.zero(SCALE_CENTS);
  const excludedAccounts: ExcludedAccount[] = [];

  for (const av of breakdown.byAccount) {
    if (av.kind !== "cash" && av.kind !== "investment") continue;
    const acct = accountById.get(av.accountId);
    if (mismatchIds.has(av.accountId)) {
      excludedAccounts.push({
        name: acct?.payload.name ?? av.accountId,
        currency: acct?.payload.currency ?? "?",
      });
      continue;
    }
    potCents = potCents.add(av.value);
  }

  // The mode currency is, by construction, the currency of any unflagged
  // account that declares one.
  let primaryCurrency: string | null = null;
  for (const acct of accounts) {
    const c = acct.payload.currency;
    if (c !== undefined && !mismatchIds.has(acct.id as string)) {
      primaryCurrency = c;
      break;
    }
  }

  return {
    potCents,
    excludedAccounts,
    manualAssetsCents: breakdown.byAccountKind.manualAsset,
    liabilitiesCents: breakdown.byAccountKind.liability,
    primaryCurrency,
  };
}
