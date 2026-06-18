import { describe, expect, it } from "vitest";
import {
  AccountPayloadSchema,
  CashAccountPayloadSchema,
  HoldingGroupPayloadSchema,
  HoldingPayloadSchema,
  InvestmentAccountPayloadSchema,
  LiabilityAccountPayloadSchema,
  ManualAssetAccountPayloadSchema,
  NetWorthSnapshotPayloadSchema,
  SpendItemPayloadSchema,
} from "./schemas.js";

describe("CashAccountPayloadSchema", () => {
  const valid = {
    kind: "cash",
    subKind: "checking",
    name: "Main Checking",
    balanceCents: "100000",
    currency: "USD",
  };

  it("accepts a valid cash payload", () => {
    expect(CashAccountPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects wrong kind", () => {
    expect(CashAccountPayloadSchema.safeParse({ ...valid, kind: "investment" }).success).toBe(
      false,
    );
  });

  it("rejects non-decimal balanceCents", () => {
    expect(CashAccountPayloadSchema.safeParse({ ...valid, balanceCents: "abc" }).success).toBe(
      false,
    );
  });

  it("accepts a valid apy decimal fraction", () => {
    expect(CashAccountPayloadSchema.safeParse({ ...valid, apy: "0.041" }).success).toBe(true);
  });

  it("accepts without apy (field is optional)", () => {
    expect(CashAccountPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-decimal apy", () => {
    expect(CashAccountPayloadSchema.safeParse({ ...valid, apy: "not-a-rate" }).success).toBe(false);
  });
});

describe("InvestmentAccountPayloadSchema", () => {
  const valid = {
    kind: "investment",
    subKind: "brokerage",
    name: "Taxable Brokerage",
    cashBalanceCents: "50000",
    currency: "USD",
    assetType: "stock",
  };

  it("accepts a valid investment payload", () => {
    expect(InvestmentAccountPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing cashBalanceCents", () => {
    const { cashBalanceCents: _, ...rest } = valid;
    expect(InvestmentAccountPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("accepts the mega-backdoor and SEP/solo sub-kinds", () => {
    expect(
      InvestmentAccountPayloadSchema.safeParse({ ...valid, subKind: "after_tax_401k" }).success,
    ).toBe(true);
    expect(
      InvestmentAccountPayloadSchema.safeParse({ ...valid, subKind: "sep_solo_401k" }).success,
    ).toBe(true);
  });
});

describe("LiabilityAccountPayloadSchema", () => {
  const valid = {
    kind: "liability",
    subKind: "credit_card",
    name: "Visa",
    balanceCents: "5000",
    currency: "USD",
  };

  it("accepts a valid liability payload", () => {
    expect(LiabilityAccountPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-decimal interestRate", () => {
    expect(
      LiabilityAccountPayloadSchema.safeParse({ ...valid, interestRate: "not-a-number" }).success,
    ).toBe(false);
  });
});

describe("ManualAssetAccountPayloadSchema", () => {
  const valid = {
    kind: "manual_asset",
    subKind: "real_estate",
    name: "House",
    valueCents: "50000000",
    currency: "USD",
  };

  it("accepts a valid manual asset payload", () => {
    expect(ManualAssetAccountPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown subKind", () => {
    expect(ManualAssetAccountPayloadSchema.safeParse({ ...valid, subKind: "yacht" }).success).toBe(
      false,
    );
  });

  it("accepts a valuedAt date string", () => {
    expect(
      ManualAssetAccountPayloadSchema.safeParse({ ...valid, valuedAt: "2026-03-01" }).success,
    ).toBe(true);
  });

  it("accepts without valuedAt (field is optional)", () => {
    expect(ManualAssetAccountPayloadSchema.safeParse(valid).success).toBe(true);
  });
});

describe("AccountPayloadSchema", () => {
  it("routes cash kind correctly", () => {
    const result = AccountPayloadSchema.safeParse({
      kind: "cash",
      subKind: "savings",
      name: "Savings",
      balanceCents: "200000",
      currency: "USD",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown kind", () => {
    expect(AccountPayloadSchema.safeParse({ kind: "unknown" }).success).toBe(false);
  });
});

describe("HoldingPayloadSchema", () => {
  const valid = {
    accountId: "acct-1",
    groupId: null,
    ticker: "AAPL",
    assetType: "stock",
    proxyTicker: null,
    sharesMajor: "100",
    sharesScale: 4,
    costBasisCents: "1000000",
  };

  it("accepts a minimal valid holding payload", () => {
    expect(HoldingPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-decimal sharesMajor", () => {
    expect(HoldingPayloadSchema.safeParse({ ...valid, sharesMajor: "bad" }).success).toBe(false);
  });
});

describe("HoldingGroupPayloadSchema", () => {
  it("accepts a valid group payload", () => {
    expect(HoldingGroupPayloadSchema.safeParse({ name: "US Equities" }).success).toBe(true);
  });

  it("rejects missing name", () => {
    expect(HoldingGroupPayloadSchema.safeParse({}).success).toBe(false);
  });
});

describe("NetWorthSnapshotPayloadSchema", () => {
  const valid = {
    snapshotAt: "2026-05-16",
    netWorthCents: "1000000",
    cashCents: "200000",
    investmentCents: "800000",
  };

  it("accepts a valid snapshot payload", () => {
    expect(NetWorthSnapshotPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-decimal netWorthCents", () => {
    expect(
      NetWorthSnapshotPayloadSchema.safeParse({ ...valid, netWorthCents: "NaN" }).success,
    ).toBe(false);
  });
});

describe("SpendItemPayloadSchema", () => {
  const valid = {
    name: "Rent",
    amountCents: "145000",
    intervalCount: 1,
    intervalUnit: "month",
    category: "housing",
    group: "essentials",
    nextRenewalAt: "2026-07-01",
    status: "active",
  };

  it("accepts a valid payload with all fields", () => {
    expect(SpendItemPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a valid payload with optional fields absent", () => {
    const { nextRenewalAt, ...rest } = valid;
    expect(SpendItemPayloadSchema.safeParse(rest).success).toBe(true);
  });

  it("accepts a multi-unit interval (every two years)", () => {
    expect(
      SpendItemPayloadSchema.safeParse({ ...valid, intervalCount: 2, intervalUnit: "year" })
        .success,
    ).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects a name longer than 64 chars", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, name: "x".repeat(65) }).success).toBe(
      false,
    );
  });

  it("rejects amountCents with a decimal point", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, amountCents: "1450.00" }).success).toBe(
      false,
    );
  });

  it("rejects amountCents of zero", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, amountCents: "0" }).success).toBe(false);
  });

  it("rejects a negative amountCents", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, amountCents: "-100" }).success).toBe(false);
  });

  it("rejects intervalCount below 1", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, intervalCount: 0 }).success).toBe(false);
  });

  it("rejects intervalCount above 99", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, intervalCount: 100 }).success).toBe(false);
  });

  it("rejects a non-integer intervalCount", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, intervalCount: 1.5 }).success).toBe(false);
  });

  it("rejects an unknown intervalUnit", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, intervalUnit: "fortnight" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed nextRenewalAt", () => {
    expect(
      SpendItemPayloadSchema.safeParse({ ...valid, nextRenewalAt: "07/01/2026" }).success,
    ).toBe(false);
  });

  it("rejects an unknown group", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, group: "luxuries" }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, category: "yacht" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(SpendItemPayloadSchema.safeParse({ ...valid, status: "archived" }).success).toBe(false);
  });
});
