import type { Account } from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";
import { formatCurrencyWhole } from "@/lib/format";

/** Extract the raw balance cents string for any account kind. */
export function getBalanceCents(account: Account): string {
  switch (account.payload.kind) {
    case "cash":
      return account.payload.balanceCents;
    case "investment":
      return account.payload.cashBalanceCents;
    case "liability":
      return account.payload.balanceCents;
    case "manual_asset":
      return account.payload.valueCents;
  }
}

/** Convert a cents string to a Decimal. */
export function centsToDecimal(cents: string): Decimal {
  return Decimal.fromMinorUnits(BigInt(cents), SCALE_CENTS);
}

/**
 * Format an account's display balance (whole dollars) in the account's own
 * currency. A normal liability (positive stored value) reads as -$X; a credit
 * balance (negative stored value) reads as $X with no sign. `showNegative` says
 * whether to render it in the negative (down) color.
 */
export function formatAccountBalanceWhole(
  account: Account,
  value: Decimal,
): { text: string; showNegative: boolean } {
  const currency = account.payload.currency;
  const showNegative = account.payload.kind === "liability" && !value.isNegative();
  const text =
    account.payload.kind === "liability"
      ? `${showNegative ? "-" : ""}${formatCurrencyWhole(value.abs(), currency)}`
      : formatCurrencyWhole(value, currency);
  return { text, showNegative };
}
