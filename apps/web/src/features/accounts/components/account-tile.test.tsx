import type { Account, AccountId, UserId } from "@privance/core";
import { asId, asIsoDateTime } from "@privance/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountTile } from "./account-tile";

// Mock ../queries to avoid pulling in sync-context and its heavy OPFS imports.
// account-tile only uses centsToDecimal and getBalanceCents from that module.
vi.mock("../queries", async () => {
  const { Decimal: D, SCALE_CENTS: SC } = await import("@privance/core");
  return {
    centsToDecimal: (cents: string) => D.fromMinorUnits(BigInt(cents), SC),
    getBalanceCents: (account: {
      payload: {
        kind: string;
        balanceCents?: string;
        cashBalanceCents?: string;
        valueCents?: string;
      };
    }) => {
      if (account.payload.kind === "investment") return account.payload.cashBalanceCents ?? "0";
      if (account.payload.kind === "manual_asset") return account.payload.valueCents ?? "0";
      return (account.payload as { balanceCents?: string }).balanceCents ?? "0";
    },
  };
});

function makeAccount(
  overrides: Partial<{ currency: string; kind: "cash" | "liability"; balanceCents: string }>,
): Account {
  const currency = overrides.currency ?? "USD";
  const kind = overrides.kind ?? "cash";
  const balanceCents = overrides.balanceCents ?? "100000";
  const base = {
    id: asId<AccountId>("acc-1"),
    userId: asId<UserId>("user-1"),
    createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    lastUpdatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
  };
  if (kind === "liability") {
    return {
      ...base,
      payload: {
        kind: "liability",
        subKind: "credit_card",
        name: "Test Card",
        balanceCents,
        currency,
      },
    };
  }
  return {
    ...base,
    payload: {
      kind: "cash",
      subKind: "checking",
      name: "Test Checking",
      balanceCents,
      currency,
    },
  };
}

function render(account: Account): string {
  return renderToStaticMarkup(
    <AccountTile account={account} onEdit={vi.fn()} onDelete={vi.fn()} />,
  );
}

describe("AccountTile currency symbol", () => {
  it("renders dollar sign for a USD cash account", () => {
    const html = render(makeAccount({ currency: "USD", kind: "cash", balanceCents: "100000" }));
    expect(html).toContain("$1,000.00");
  });

  it("renders euro symbol for a EUR cash account, not dollar sign", () => {
    const html = render(makeAccount({ currency: "EUR", kind: "cash", balanceCents: "50000" }));
    expect(html).toContain("€500.00");
    expect(html).not.toContain("$500.00");
  });

  it("renders euro symbol for a EUR liability account", () => {
    const html = render(makeAccount({ currency: "EUR", kind: "liability", balanceCents: "20000" }));
    expect(html).toContain("€200.00");
    expect(html).not.toContain("$200.00");
  });
});

describe("AccountTile liability double-negative", () => {
  it("renders normal liability as a negative debt (e.g. -$500.00)", () => {
    // Positive stored balance on a liability = a debt; should display as -$500.00.
    const html = render(makeAccount({ kind: "liability", balanceCents: "50000" }));
    expect(html).toContain("-$500.00");
    expect(html).not.toContain("-$-");
  });

  it("renders a liability with a negative stored balance as a credit (no double-negative)", () => {
    // Negative stored balance on a liability = overpayment/credit; should display as $5.00 (positive).
    const html = render(makeAccount({ kind: "liability", balanceCents: "-500" }));
    expect(html).toContain("$5.00");
    expect(html).not.toContain("-$5.00");
    expect(html).not.toContain("-$-");
  });
});
