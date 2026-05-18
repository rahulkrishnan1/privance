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
} from "./schemas.js";

// ---------------------------------------------------------------------------
// CashAccountPayloadSchema
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// InvestmentAccountPayloadSchema
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// LiabilityAccountPayloadSchema
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ManualAssetAccountPayloadSchema
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// AccountPayloadSchema (discriminated union)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// HoldingPayloadSchema
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// HoldingGroupPayloadSchema
// ---------------------------------------------------------------------------

describe("HoldingGroupPayloadSchema", () => {
  it("accepts a valid group payload", () => {
    expect(HoldingGroupPayloadSchema.safeParse({ name: "US Equities" }).success).toBe(true);
  });

  it("rejects missing name", () => {
    expect(HoldingGroupPayloadSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NetWorthSnapshotPayloadSchema
// ---------------------------------------------------------------------------

describe("NetWorthSnapshotPayloadSchema", () => {
  const valid = {
    snapshotAt: "2026-05-16",
    netWorthCents: "1000000",
    cashCents: "200000",
    investmentCents: "800000",
    accountCount: 3,
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
