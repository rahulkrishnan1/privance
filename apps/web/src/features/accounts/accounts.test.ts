/**
 * Unit tests for the accounts feature, covers logic, schema validation,
 * and state helpers. Component rendering tests are covered by E2E.
 */

import type { Account, AccountId, CashAccount, UserId } from "@privance/core";
import { asId, asIsoDateTime, SCALE_CENTS } from "@privance/core";
import { describe, expect, it } from "vitest";
import { centsToDecimal, getBalanceCents, sumBalances } from "./balance";
import { accountFormSchema, SECTION_ORDER } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCash(opts: { id?: string; balanceCents?: string; currency?: string }): CashAccount {
  return {
    id: asId<AccountId>(opts.id ?? "cash-1"),
    userId: asId<UserId>("user-1"),
    createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    lastUpdatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    payload: {
      kind: "cash",
      subKind: "checking",
      name: "Checking",
      balanceCents: opts.balanceCents ?? "10000",
      currency: opts.currency ?? "USD",
    },
  };
}

function makeLiability(opts: { balanceCents?: string }): Account {
  return {
    id: asId<AccountId>("liab-1"),
    userId: asId<UserId>("user-1"),
    createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    lastUpdatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    payload: {
      kind: "liability",
      subKind: "credit_card",
      name: "Card",
      balanceCents: opts.balanceCents ?? "5000",
      currency: "USD",
    },
  };
}

// ---------------------------------------------------------------------------
// getBalanceCents
// ---------------------------------------------------------------------------

describe("getBalanceCents", () => {
  it("returns balanceCents for cash", () => {
    const account = makeCash({ balanceCents: "12345" });
    expect(getBalanceCents(account)).toBe("12345");
  });

  it("returns balanceCents for liability", () => {
    const account = makeLiability({ balanceCents: "99900" });
    expect(getBalanceCents(account)).toBe("99900");
  });

  it("returns cashBalanceCents for investment", () => {
    const account: Account = {
      id: asId<AccountId>("inv-1"),
      userId: asId<UserId>("user-1"),
      createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
      lastUpdatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
      payload: {
        kind: "investment",
        subKind: "brokerage",
        name: "Brokerage",
        cashBalanceCents: "50000",
        currency: "USD",
        assetType: "stock",
      },
    };
    expect(getBalanceCents(account)).toBe("50000");
  });

  it("returns valueCents for manual_asset", () => {
    const account: Account = {
      id: asId<AccountId>("asset-1"),
      userId: asId<UserId>("user-1"),
      createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
      lastUpdatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
      payload: {
        kind: "manual_asset",
        subKind: "real_estate",
        name: "House",
        valueCents: "30000000",
        currency: "USD",
      },
    };
    expect(getBalanceCents(account)).toBe("30000000");
  });
});

// ---------------------------------------------------------------------------
// centsToDecimal
// ---------------------------------------------------------------------------

describe("centsToDecimal", () => {
  it("converts positive cents string to Decimal", () => {
    const d = centsToDecimal("10050");
    expect(d.toString()).toBe("100.50");
  });

  it("converts zero", () => {
    const d = centsToDecimal("0");
    expect(d.isZero()).toBe(true);
  });

  it("converts negative cents", () => {
    const d = centsToDecimal("-500");
    expect(d.toString()).toBe("-5.00");
  });
});

// ---------------------------------------------------------------------------
// sumBalances
// ---------------------------------------------------------------------------

describe("sumBalances", () => {
  it("sums multiple cash accounts", () => {
    const accounts: Account[] = [
      makeCash({ balanceCents: "10000" }),
      makeCash({ id: "cash-2", balanceCents: "5050" }),
    ];
    const result = sumBalances(accounts);
    expect(result.toString()).toBe("150.50");
  });

  it("subtracts liability balances from total", () => {
    const accounts: Account[] = [
      makeCash({ balanceCents: "20000" }),
      makeLiability({ balanceCents: "5000" }),
    ];
    const result = sumBalances(accounts);
    expect(result.toString()).toBe("150.00");
  });

  it("returns zero for empty list", () => {
    const result = sumBalances([]);
    expect(result.isZero()).toBe(true);
    expect(result.scale).toBe(SCALE_CENTS);
  });

  it("handles all liabilities", () => {
    const accounts: Account[] = [makeLiability({ balanceCents: "10000" })];
    const result = sumBalances(accounts);
    expect(result.toString()).toBe("-100.00");
    expect(result.isNegative()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// accountFormSchema validation
// ---------------------------------------------------------------------------

describe("accountFormSchema", () => {
  const valid = {
    name: "My Checking",
    kind: "cash" as const,
    currency: "USD",
    balance: "1234.56",
    archived: false,
  };

  it("accepts a valid form payload", () => {
    const result = accountFormSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = accountFormSchema.safeParse({ ...valid, name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const nameError = result.error.issues.find((i) => i.path[0] === "name");
      expect(nameError).toBeDefined();
    }
  });

  it("rejects name longer than 64 characters", () => {
    const result = accountFormSchema.safeParse({ ...valid, name: "a".repeat(65) });
    expect(result.success).toBe(false);
  });

  it("rejects a non-3-uppercase-letter currency", () => {
    expect(accountFormSchema.safeParse({ ...valid, currency: "us" }).success).toBe(false);
    expect(accountFormSchema.safeParse({ ...valid, currency: "usd" }).success).toBe(false);
    expect(accountFormSchema.safeParse({ ...valid, currency: "USDT" }).success).toBe(false);
  });

  it("accepts valid 3-letter uppercase currency codes", () => {
    expect(accountFormSchema.safeParse({ ...valid, currency: "EUR" }).success).toBe(true);
    expect(accountFormSchema.safeParse({ ...valid, currency: "JPY" }).success).toBe(true);
  });

  it("rejects non-numeric balance", () => {
    const result = accountFormSchema.safeParse({ ...valid, balance: "abc" });
    expect(result.success).toBe(false);
  });

  it("treats empty balance as 0", () => {
    const result = accountFormSchema.safeParse({ ...valid, balance: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.balance).toBe("0");
  });

  it("accepts integer balance", () => {
    const result = accountFormSchema.safeParse({ ...valid, balance: "100" });
    expect(result.success).toBe(true);
  });

  it("rejects balance with more than 2 decimal places", () => {
    const result = accountFormSchema.safeParse({ ...valid, balance: "1.234" });
    expect(result.success).toBe(false);
  });

  it("accepts negative balance", () => {
    const result = accountFormSchema.safeParse({ ...valid, balance: "-50.00" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section order
// ---------------------------------------------------------------------------

describe("SECTION_ORDER", () => {
  it("renders Cash → Investment → Manual Asset → Liability", () => {
    expect(SECTION_ORDER).toEqual(["cash", "investment", "manual_asset", "liability"]);
  });
});

// ---------------------------------------------------------------------------
// Decimal usage, no Number coercion
// ---------------------------------------------------------------------------

describe("no floating-point coercion in Decimal usage", () => {
  it("centsToDecimal avoids floating-point errors for large values", () => {
    const d = centsToDecimal("9007199254740993");
    expect(d.toMinorUnits().toString()).toBe("9007199254740993");
  });
});
