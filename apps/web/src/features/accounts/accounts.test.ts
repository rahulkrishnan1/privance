/**
 * Unit tests for the accounts feature, covers logic, schema validation,
 * and state helpers. Component rendering tests are covered by E2E.
 */

import type { Account, AccountId, CashAccount, UserId } from "@privance/core";
import { asId, asIsoDateTime } from "@privance/core";
import { describe, expect, it } from "vitest";
import { centsToDecimal, formatAccountBalanceWhole, getBalanceCents } from "./balance";
import { accountFormSchema, SECTION_ORDER } from "./types";

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

describe("formatAccountBalanceWhole", () => {
  it("formats a cash balance in the account's own currency", () => {
    const eur = makeCash({ balanceCents: "150000", currency: "EUR" });
    const { text, showNegative } = formatAccountBalanceWhole(eur, centsToDecimal("150000"));
    expect(text).toBe("€1,500");
    expect(showNegative).toBe(false);
  });

  it("renders a normal liability (positive stored value) as a negative debt", () => {
    const debt = makeLiability({ balanceCents: "500" });
    const { text, showNegative } = formatAccountBalanceWhole(debt, centsToDecimal("500"));
    expect(text).toBe("-$5");
    expect(showNegative).toBe(true);
  });

  it("renders a liability credit (negative stored value) as a positive, no double negative", () => {
    const credit = makeLiability({ balanceCents: "-500" });
    const { text, showNegative } = formatAccountBalanceWhole(credit, centsToDecimal("-500"));
    expect(text).toBe("$5");
    expect(showNegative).toBe(false);
  });
});

describe("accountFormSchema", () => {
  const valid = {
    name: "My Checking",
    kind: "cash" as const,
    currency: "USD",
    balance: "1234.56",
    subKind: "checking" as const,
    archived: false,
  };

  it("accepts a valid form payload", () => {
    const result = accountFormSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("requires a subKind for cash and investment accounts", () => {
    const { subKind, ...withoutSubKind } = valid;
    const result = accountFormSchema.safeParse(withoutSubKind);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "subKind");
      expect(issue?.message).toBe("Select an account type");
    }
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

describe("SECTION_ORDER", () => {
  it("renders Investment -> Cash -> Manual Asset -> Liability (investments first)", () => {
    expect(SECTION_ORDER).toEqual(["investment", "cash", "manual_asset", "liability"]);
  });
});

describe("no floating-point coercion in Decimal usage", () => {
  it("centsToDecimal avoids floating-point errors for large values", () => {
    const d = centsToDecimal("9007199254740993");
    expect(d.toMinorUnits().toString()).toBe("9007199254740993");
  });
});
