import type { InvestmentAccountSubKind } from "@privance/core";

export { INVESTMENT_TYPE_OPTIONS, SUBKIND_TAG } from "@/features/accounts";

export type TaxTreatment = "taxable" | "pretax" | "roth" | "hsa" | "college";

export const TAX_TREATMENT_BY_SUBKIND: Record<InvestmentAccountSubKind, TaxTreatment> = {
  brokerage: "taxable",
  crypto_wallet: "taxable",
  other_investment: "taxable",
  "401k": "pretax",
  "403b": "pretax",
  ira: "pretax",
  sep_solo_401k: "pretax",
  after_tax_401k: "pretax",
  roth_401k: "roth",
  roth_ira: "roth",
  hsa: "hsa",
  "529": "college",
};

export const TAX_TREATMENT_LABEL: Record<TaxTreatment, string> = {
  taxable: "Taxable",
  pretax: "Pre-tax",
  roth: "Roth",
  hsa: "HSA",
  college: "529",
};
