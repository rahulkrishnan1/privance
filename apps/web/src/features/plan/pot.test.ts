import type { Account, AccountId, Holding, HoldingId, UserId } from "@privance/core";
import { asId, asIsoDateTime, Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test } from "vitest";
import { deriveLiquidPot } from "./pot";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const NOW = asIsoDateTime("2024-01-01T00:00:00.000Z");
const NO_PRICES = new Map<string, Decimal>();

function makeAccountId(s: string): ReturnType<typeof asId<AccountId>> {
  return asId<AccountId>(s);
}

function cash(id: string, name: string, balanceCents: string, currency = "USD"): Account {
  return {
    id: makeAccountId(id),
    userId: asId<UserId>("u1"),
    createdAt: NOW,
    lastUpdatedAt: NOW,
    payload: { kind: "cash", subKind: "checking", name, balanceCents, currency },
  } as Account;
}

function investment(id: string, name: string, cashBalanceCents: string, currency = "USD"): Account {
  return {
    id: makeAccountId(id),
    userId: asId<UserId>("u1"),
    createdAt: NOW,
    lastUpdatedAt: NOW,
    payload: {
      kind: "investment",
      subKind: "brokerage",
      name,
      cashBalanceCents,
      currency,
      assetType: "stock",
    },
  } as Account;
}

function manualAsset(id: string, name: string, valueCents: string, currency = "USD"): Account {
  return {
    id: makeAccountId(id),
    userId: asId<UserId>("u1"),
    createdAt: NOW,
    lastUpdatedAt: NOW,
    payload: {
      kind: "manual_asset",
      subKind: "real_estate",
      name,
      valueCents,
      currency,
    },
  } as Account;
}

function liability(id: string, name: string, balanceCents: string, currency = "USD"): Account {
  return {
    id: makeAccountId(id),
    userId: asId<UserId>("u1"),
    createdAt: NOW,
    lastUpdatedAt: NOW,
    payload: {
      kind: "liability",
      subKind: "mortgage",
      name,
      balanceCents,
      currency,
    },
  } as Account;
}

function holding(accountId: string, ticker: string, shares: string, scale = 0): Holding {
  return {
    id: asId<HoldingId>(`h-${accountId}-${ticker}`),
    userId: asId<UserId>("u1"),
    createdAt: NOW,
    updatedAt: NOW,
    payload: {
      accountId: asId<AccountId>(accountId),
      groupId: null,
      ticker,
      assetType: "stock",
      proxyTicker: null,
      sharesMajor: shares,
      sharesScale: scale,
      costBasisCents: "0",
    },
  } as Holding;
}

function priceMap(entries: [string, number][]): Map<string, Decimal> {
  const m = new Map<string, Decimal>();
  for (const [ticker, dollars] of entries) {
    m.set(ticker, Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS));
  }
  return m;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("sums cash and investment accounts", () => {
  const accounts = [
    cash("c1", "Checking", "100000"), // $1,000
    investment("i1", "Brokerage", "200000"), // $2,000 cash sweep
  ];
  const result = deriveLiquidPot({ accounts, holdings: [], prices: NO_PRICES });
  // $1,000 + $2,000 = $3,000 = 300000 cents
  expect(result.potCents.toMinorUnits()).toBe(300000n);
  expect(result.primaryCurrency).toBe("USD");
  expect(result.excludedAccounts).toHaveLength(0);
});

test("includes investment account holdings at market value", () => {
  const accounts = [investment("i1", "Brokerage", "0")];
  const holdings_ = [holding("i1", "AAPL", "10", 0)]; // 10 shares
  const prices = priceMap([["AAPL", 150]]); // $150/share = $1,500
  const result = deriveLiquidPot({ accounts, holdings: holdings_, prices });
  expect(result.potCents.toMinorUnits()).toBe(150000n); // $1,500
});

test("manual_asset accounts are excluded from pot and returned as context", () => {
  const accounts = [
    cash("c1", "Checking", "100000"),
    manualAsset("m1", "Home", "50000000"), // $500,000 home
  ];
  const result = deriveLiquidPot({ accounts, holdings: [], prices: NO_PRICES });
  expect(result.potCents.toMinorUnits()).toBe(100000n); // only cash
  expect(result.manualAssetsCents.toMinorUnits()).toBe(50000000n);
  // manual_asset is not listed in excludedAccounts (that list is for currency exclusions)
  expect(result.excludedAccounts).toHaveLength(0);
});

test("liability accounts are excluded from pot and returned as context", () => {
  const accounts = [
    cash("c1", "Checking", "100000"),
    liability("l1", "Mortgage", "20000000"), // $200,000 owed
  ];
  const result = deriveLiquidPot({ accounts, holdings: [], prices: NO_PRICES });
  expect(result.potCents.toMinorUnits()).toBe(100000n); // only cash
  expect(result.liabilitiesCents.toMinorUnits()).toBe(20000000n);
});

test("mixed-currency accounts: restricts pot to primary currency", () => {
  // 2 USD accounts + 1 EUR account => primary is USD
  const accounts = [
    cash("c1", "USD Checking", "100000", "USD"),
    cash("c2", "USD Savings", "200000", "USD"),
    cash("c3", "EUR Account", "300000", "EUR"),
  ];
  const result = deriveLiquidPot({ accounts, holdings: [], prices: NO_PRICES });
  expect(result.primaryCurrency).toBe("USD");
  expect(result.potCents.toMinorUnits()).toBe(300000n); // only USD accounts
  expect(result.excludedAccounts).toHaveLength(1);
  expect(result.excludedAccounts[0]?.name).toBe("EUR Account");
  expect(result.excludedAccounts[0]?.currency).toBe("EUR");
});

test("empty accounts returns zero pot with no exclusions", () => {
  const result = deriveLiquidPot({ accounts: [], holdings: [], prices: NO_PRICES });
  expect(result.potCents.toMinorUnits()).toBe(0n);
  expect(result.excludedAccounts).toHaveLength(0);
  expect(result.primaryCurrency).toBeNull();
});

test("manual-asset-only user has zero pot and populated manualAssetsCents", () => {
  const accounts = [manualAsset("m1", "Rental Property", "50000000", "USD")];
  const result = deriveLiquidPot({ accounts, holdings: [], prices: NO_PRICES });
  expect(result.potCents.toMinorUnits()).toBe(0n);
  expect(result.manualAssetsCents.toMinorUnits()).toBe(50000000n);
  expect(result.excludedAccounts).toHaveLength(0);
});
