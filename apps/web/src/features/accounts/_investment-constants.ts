import type { CashAccountSubKind, InvestmentAccountSubKind } from "@privance/core";

export const CASH_TYPE_OPTIONS: Array<{
  value: CashAccountSubKind;
  label: string;
}> = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "money_market", label: "Money market" },
  { value: "cd", label: "CD" },
  { value: "other_cash", label: "Other" },
];

export const CASH_TYPE_LABEL: Record<CashAccountSubKind, string> = Object.fromEntries(
  CASH_TYPE_OPTIONS.map(({ value, label }) => [value, label]),
) as Record<CashAccountSubKind, string>;

export const INVESTMENT_TYPE_OPTIONS: Array<{
  value: InvestmentAccountSubKind;
  label: string;
}> = [
  { value: "brokerage", label: "Taxable brokerage" },
  { value: "401k", label: "Traditional 401(k) / 403(b)" },
  { value: "roth_401k", label: "Roth 401(k) / 403(b)" },
  { value: "ira", label: "Traditional IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "sep_solo_401k", label: "SEP-IRA / Solo 401(k)" },
  { value: "hsa", label: "HSA" },
  { value: "529", label: "529 college" },
  { value: "crypto_wallet", label: "Crypto wallet" },
];

// Row subtitle is the tax treatment only; the account type already shows as the
// group header and in the detail sheet.
export const SUBKIND_TAG: Record<InvestmentAccountSubKind, string> = {
  brokerage: "taxable",
  crypto_wallet: "taxable",
  other_investment: "taxable",
  "401k": "pre-tax",
  "403b": "pre-tax",
  ira: "pre-tax",
  sep_solo_401k: "pre-tax",
  after_tax_401k: "after-tax",
  roth_401k: "post-tax",
  roth_ira: "post-tax",
  hsa: "triple-advantaged",
  "529": "college",
};

// Full account-type names for the detail header (the dialog options group some of
// these, so this is the per-subkind source of truth; exhaustive by type).
export const SUBKIND_TYPE_LABEL: Record<InvestmentAccountSubKind, string> = {
  brokerage: "Brokerage",
  crypto_wallet: "Crypto wallet",
  other_investment: "Investment",
  "401k": "401(k)",
  "403b": "403(b)",
  ira: "Traditional IRA",
  sep_solo_401k: "SEP / Solo 401(k)",
  after_tax_401k: "After-tax 401(k)",
  roth_401k: "Roth 401(k)",
  roth_ira: "Roth IRA",
  hsa: "HSA",
  "529": "529",
};
