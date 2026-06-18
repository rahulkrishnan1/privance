import { describe, expect, it } from "vitest";
import type {
  Account,
  CashAccount,
  InvestmentAccount,
  LiabilityAccount,
  ManualAssetAccount,
} from "./account.js";
import type { ActivityKind } from "./activity.js";
import { ACTIVITY_KINDS } from "./activity.js";
import type { Holding, HoldingGroup } from "./holding.js";
import type { NetWorthSnapshot } from "./networth.js";
import type { Price } from "./price.js";
import type { AccountId, HoldingId, UserId } from "./types.js";
import { asId, asIsoDate, asIsoDateTime } from "./types.js";

describe("id casting helpers", () => {
  it("asId casts string to branded AccountId", () => {
    const id = asId<AccountId>("abc-123");
    expect(id).toBe("abc-123");
  });

  it("asIsoDate casts string to IsoDate", () => {
    const d = asIsoDate("2026-05-16");
    expect(d).toBe("2026-05-16");
  });

  it("asIsoDateTime casts string to IsoDateTime", () => {
    const dt = asIsoDateTime("2026-05-16T12:00:00Z");
    expect(dt).toBe("2026-05-16T12:00:00Z");
  });
});

describe("ACTIVITY_KINDS", () => {
  it("contains exactly 14 kinds", () => {
    expect(ACTIVITY_KINDS).toHaveLength(14);
  });

  const expected: readonly ActivityKind[] = [
    "BUY",
    "SELL",
    "SPLIT",
    "DEPOSIT",
    "WITHDRAWAL",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "DIVIDEND",
    "INTEREST",
    "CREDIT",
    "FEE",
    "TAX",
    "ADJUSTMENT",
    "UNKNOWN",
  ];

  it("contains all expected kinds", () => {
    for (const kind of expected) {
      expect(ACTIVITY_KINDS).toContain(kind);
    }
  });

  it("contains no unexpected kinds", () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(expected).toContain(kind);
    }
  });
});

describe("CashAccount shape", () => {
  it("constructs a valid CashAccount record", () => {
    const account: CashAccount = {
      id: asId("ca-1"),
      userId: asId<UserId>("u-1"),
      createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      payload: {
        kind: "cash",
        subKind: "checking",
        name: "Main Checking",
        balanceCents: "150000",
        currency: "USD",
      },
    };
    expect(account.payload.kind).toBe("cash");
    expect(account.payload.balanceCents).toBe("150000");
  });
});

describe("InvestmentAccount shape", () => {
  it("constructs a valid InvestmentAccount record", () => {
    const account: InvestmentAccount = {
      id: asId("ia-1"),
      userId: asId<UserId>("u-1"),
      createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      payload: {
        kind: "investment",
        subKind: "brokerage",
        name: "Fidelity Taxable",
        cashBalanceCents: "50000",
        currency: "USD",
        assetType: "stock",
      },
    };
    expect(account.payload.kind).toBe("investment");
  });

  it("Account discriminated union narrows correctly", () => {
    const accounts: Account[] = [
      {
        id: asId("ca-2"),
        userId: asId<UserId>("u-1"),
        createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
        lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
        payload: {
          kind: "cash",
          subKind: "savings",
          name: "HYSA",
          balanceCents: "0",
          currency: "USD",
        },
      },
    ];
    const first = accounts[0];
    if (first !== undefined && first.payload.kind === "cash") {
      expect(first.payload.subKind).toBe("savings");
    }
  });
});

describe("LiabilityAccount shape", () => {
  it("constructs a valid LiabilityAccount record", () => {
    const account: LiabilityAccount = {
      id: asId("la-1"),
      userId: asId<UserId>("u-1"),
      createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      payload: {
        kind: "liability",
        subKind: "mortgage",
        name: "Primary Home Mortgage",
        institutionName: "ACME Bank",
        balanceCents: "32500000",
        currency: "USD",
        interestRate: "0.0625",
        originalPrincipalCents: "40000000",
      },
    };
    expect(account.payload.kind).toBe("liability");
    expect(account.payload.balanceCents).toBe("32500000");
  });

  it("narrows liability vs asset in the Account union", () => {
    const a: Account = {
      id: asId("la-2"),
      userId: asId<UserId>("u-1"),
      createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      payload: {
        kind: "liability",
        subKind: "credit_card",
        name: "Chase Sapphire",
        balanceCents: "150000",
        currency: "USD",
      },
    };
    if (a.payload.kind === "liability") {
      expect(a.payload.subKind).toBe("credit_card");
    }
  });
});

describe("ManualAssetAccount shape", () => {
  it("constructs a valid ManualAssetAccount record", () => {
    const account: ManualAssetAccount = {
      id: asId("ma-1"),
      userId: asId<UserId>("u-1"),
      createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      lastUpdatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      payload: {
        kind: "manual_asset",
        subKind: "real_estate",
        name: "Primary Residence",
        identifier: "123 Main St, Anytown",
        valueCents: "55000000",
        currency: "USD",
        costBasisCents: "48000000",
        acquiredAt: asIsoDateTime("2021-06-15T00:00:00Z"),
      },
    };
    expect(account.payload.kind).toBe("manual_asset");
    expect(account.payload.subKind).toBe("real_estate");
  });
});

describe("Holding shape", () => {
  it("constructs a valid Holding record", () => {
    const holding: Holding = {
      id: asId<HoldingId>("h-1"),
      userId: asId("u-1"),
      createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      updatedAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      payload: {
        accountId: asId("ia-1"),
        groupId: null,
        ticker: "AAPL",
        assetType: "stock",
        proxyTicker: null,
        sharesMajor: "10.0000",
        sharesScale: 4,
        costBasisCents: "15000",
      },
    };
    expect(holding.payload.ticker).toBe("AAPL");
    expect(holding.payload.sharesScale).toBe(4);
  });

  it("HoldingGroup constructs correctly", () => {
    const group: HoldingGroup = {
      id: asId("hg-1"),
      userId: asId<UserId>("u-1"),
      createdAt: asIsoDateTime("2026-01-01T00:00:00Z"),
      payload: { name: "US Equities" },
    };
    expect(group.payload.name).toBe("US Equities");
  });
});

describe("Price shape", () => {
  it("constructs a valid Price record", () => {
    const price: Price = {
      id: asId("pr-1"),
      ticker: "AAPL",
      assetType: "stock",
      price: "185.250000",
      fetchedAt: asIsoDateTime("2026-05-16T16:00:00Z"),
      source: "yahoo",
    };
    expect(price.ticker).toBe("AAPL");
    expect(price.source).toBe("yahoo");
  });
});

describe("NetWorthSnapshot shape", () => {
  it("constructs a valid NetWorthSnapshot record", () => {
    const snapshot: NetWorthSnapshot = {
      id: asId("nw-1"),
      userId: asId<UserId>("u-1"),
      createdAt: asIsoDateTime("2026-05-16T23:59:59Z"),
      updatedAt: asIsoDateTime("2026-05-16T23:59:59Z"),
      payload: {
        snapshotAt: asIsoDate("2026-05-16"),
        netWorthCents: "1000000",
        cashCents: "250000",
        investmentCents: "750000",
      },
    };
    expect(snapshot.payload.snapshotAt).toBe("2026-05-16");
    expect(snapshot.payload.investmentCents).toBe("750000");
  });
});
