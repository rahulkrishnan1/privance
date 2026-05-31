import type { Account, AccountId, UserId } from "@privance/core";
import { asId, asIsoDateTime } from "@privance/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountSection } from "./account-section";

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

function makeCash(id: string, currency: string, balanceCents: string): Account {
  return {
    id: asId<AccountId>(id),
    userId: asId<UserId>("user-1"),
    createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    lastUpdatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    payload: { kind: "cash", subKind: "checking", name: `Account ${id}`, balanceCents, currency },
  };
}

const meta = { label: "Cash", addLabel: "Add cash account" };

describe("AccountSection subtotal currency", () => {
  it("shows euro symbol when all accounts share EUR currency", () => {
    const accounts = [makeCash("acc-1", "EUR", "50000"), makeCash("acc-2", "EUR", "30000")];
    const html = renderToStaticMarkup(
      <AccountSection meta={meta} accounts={accounts} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(html).toContain("€800.00");
    expect(html).not.toContain("$800.00");
  });

  it("omits subtotal when accounts have mixed currencies", () => {
    const accounts = [makeCash("acc-1", "USD", "50000"), makeCash("acc-2", "EUR", "30000")];
    const html = renderToStaticMarkup(
      <AccountSection meta={meta} accounts={accounts} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    // Neither currency symbol should appear as a subtotal (no dollar or euro amount shown).
    // The section header label must still render.
    expect(html).toContain("Cash");
    expect(html).not.toContain("$800.00");
    expect(html).not.toContain("€800.00");
  });
});
