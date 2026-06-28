import type { Account, AccountId, HoldingId, HoldingValuation, UserId } from "@privance/core";
import { asId, asIsoDateTime, Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Mock the accounts/queries dependency so the browser test doesn't load the
// full sync-context chain.
vi.mock("@/features/accounts/queries", () => ({
  centsToDecimal: (s: string) => Decimal.fromMinorUnits(BigInt(s), SCALE_CENTS),
}));

import { AccountDetailSheet } from "./account-detail-sheet";

function dec(cents: bigint): Decimal {
  return Decimal.fromMinorUnits(cents, SCALE_CENTS);
}

function valuation(opts: { cost: bigint; pnl: bigint }, i = 0): HoldingValuation {
  return {
    holdingId: asId<HoldingId>(`h${i}`),
    marketValue: dec(opts.cost + opts.pnl),
    costBasis: dec(opts.cost),
    unrealizedPnl: dec(opts.pnl),
  };
}

const TS = asIsoDateTime("2026-01-01T00:00:00.000Z");

function makeInvestAccount(): Account {
  return {
    id: asId<AccountId>("acct-1"),
    userId: asId<UserId>("user-1"),
    createdAt: TS,
    lastUpdatedAt: TS,
    payload: {
      kind: "investment",
      subKind: "401k",
      name: "Fidelity 401(k)",
      cashBalanceCents: "0",
      currency: "USD",
      assetType: "stock",
    },
  } as Account;
}

function makeCashAccount(): Account {
  return {
    id: asId<AccountId>("acct-2"),
    userId: asId<UserId>("user-1"),
    createdAt: TS,
    lastUpdatedAt: TS,
    payload: {
      kind: "cash",
      subKind: "checking",
      name: "BoA Checking",
      balanceCents: "300000",
      currency: "USD",
    },
  } as Account;
}

test("renders account type tag, name, and value for an investment account", async () => {
  const account = makeInvestAccount();
  const screen = await render(
    <AccountDetailSheet
      account={account}
      totalValue={dec(500000n)}
      holdingValuations={[]}
      holdingsByAccount={[]}
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  await expect.element(screen.getByText(/401\(K\)\s*·\s*PRE-TAX/)).toBeVisible();
  await expect.element(screen.getByText("Fidelity 401(k)")).toBeVisible();
  const valueEl = document.querySelector('[data-testid="account-detail-value"]');
  expect(valueEl).not.toBeNull();
  expect(valueEl?.textContent).toContain("5,000");
});

test("renders the cash sub-type as the blue type tag", async () => {
  const account = makeCashAccount();
  const screen = await render(
    <AccountDetailSheet
      account={account}
      totalValue={dec(300000n)}
      holdingValuations={[]}
      holdingsByAccount={[]}
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  await expect.element(screen.getByText("CHECKING", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "BoA Checking" })).toBeVisible();
});

test("shows a positive unrealized gain with the dollar amount and percent", async () => {
  const account = makeInvestAccount();
  await render(
    <AccountDetailSheet
      account={account}
      totalValue={dec(1_200_000n)}
      holdingValuations={[
        valuation({ cost: 600_000n, pnl: 100_000n }, 0),
        valuation({ cost: 400_000n, pnl: 100_000n }, 1),
      ]}
      holdingsByAccount={[]}
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  const gain = [...document.querySelectorAll("p")].find((p) =>
    p.textContent?.includes("unrealized"),
  );
  expect(gain).toBeDefined();
  const text = gain?.textContent ?? "";
  expect(text).toContain("+$2,000");
  expect(text).toContain("+20.00%");
});

test("shows a negative unrealized loss with a minus sign and negative percent", async () => {
  const account = makeInvestAccount();
  await render(
    <AccountDetailSheet
      account={account}
      totalValue={dec(850_000n)}
      holdingValuations={[valuation({ cost: 1_000_000n, pnl: -150_000n }, 0)]}
      holdingsByAccount={[]}
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  const loss = [...document.querySelectorAll("p")].find((p) =>
    p.textContent?.includes("unrealized"),
  );
  expect(loss).toBeDefined();
  const text = loss?.textContent ?? "";
  expect(text).toContain("-$1,500");
  expect(text).toContain("-15.00%");
  expect(text).not.toContain("+");
});

test("two-tap delete: first shows Tap again to delete, second calls onDelete", async () => {
  vi.useFakeTimers();
  const onDelete = vi.fn(() => Promise.resolve());
  const account = makeInvestAccount();
  const screen = await render(
    <AccountDetailSheet
      account={account}
      totalValue={dec(0n)}
      holdingValuations={[]}
      holdingsByAccount={[]}
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={onDelete}
    />,
  );

  await screen.getByRole("button", { name: "Delete" }).click();
  await expect.element(screen.getByRole("button", { name: "Tap again to delete" })).toBeVisible();
  expect(onDelete).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Tap again to delete" }).click();
  await vi.waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));

  vi.useRealTimers();
});
