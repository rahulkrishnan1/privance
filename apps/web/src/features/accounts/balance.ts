import type { Account } from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";

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

/** Sum balances for a list of accounts. Liabilities are subtracted. */
export function sumBalances(accounts: Account[]): Decimal {
  return accounts.reduce((acc, a) => {
    const amount = centsToDecimal(getBalanceCents(a));
    return a.payload.kind === "liability" ? acc.sub(amount) : acc.add(amount);
  }, Decimal.zero(SCALE_CENTS));
}
