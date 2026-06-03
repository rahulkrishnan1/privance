import type { Account, AccountId, CashAccount, UserId } from "@privance/core";
import { asId, asIsoDateTime } from "@privance/core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Holder is created via vi.hoisted so the (hoisted) vi.mock factory can read it.
// Flipped between renders to simulate the initial sync arriving (empty ->
// populated) while the Add dialog is open.
const h = vi.hoisted(() => ({
  accounts: { status: "success", data: [] as unknown[] },
}));

// Mock without importOriginal so the real module (and its sync-context ->
// @privance/core/storage chain, unresolvable in browser-mode) never loads. The
// pure cents helpers come from ./balance directly.
vi.mock("./queries", async () => {
  const { centsToDecimal, getBalanceCents } = await import("./balance");
  return { useAccountsQuery: () => h.accounts, centsToDecimal, getBalanceCents };
});
vi.mock("./mutations", () => ({
  useCreateAccount: () => ({ create: vi.fn(() => Promise.resolve()), state: "idle" }),
  useUpdateAccount: () => ({ update: vi.fn(() => Promise.resolve()), state: "idle" }),
  useDeleteAccount: () => ({ deleteAccount: vi.fn(() => Promise.resolve()) }),
}));
vi.mock("../holdings/queries", () => ({ useHoldingsQuery: () => ({ holdings: [] }) }));
vi.mock("@/lib/queries/prices", () => ({ usePricesQuery: () => ({ prices: new Map() }) }));

import { AccountsScreen } from "./accounts-screen";

function makeCash(name: string): CashAccount {
  return {
    id: asId<AccountId>("cash-1"),
    userId: asId<UserId>("user-1"),
    createdAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    lastUpdatedAt: asIsoDateTime("2024-01-01T00:00:00.000Z"),
    payload: { kind: "cash", subKind: "checking", name, balanceCents: "10000", currency: "USD" },
  };
}

// Regression: the Add/Edit dialog used to be rendered inside both the empty-state
// and the list branches. When the first sync arrived and the list flipped empty
// -> populated, React remounted the dialog and wiped a half-typed entry. The
// dialog is now mounted once outside that branch; a background data change must
// not clear an open form.
test("a typed account name survives the list transitioning empty -> populated", async () => {
  h.accounts = { status: "success", data: [] };
  const screen = await render(<AccountsScreen />);

  await screen.getByRole("button", { name: "Add your first account" }).click();
  await screen.getByRole("textbox", { name: "Account name" }).fill("Survives Sync");

  // The initial sync resolves: the screen re-renders in list mode.
  h.accounts = { status: "success", data: [makeCash("Existing") as Account] };
  screen.rerender(<AccountsScreen />);

  // Sanity: the transition actually happened (list now shows the account).
  await expect.element(screen.getByText("Existing")).toBeVisible();

  await expect
    .element(screen.getByRole("textbox", { name: "Account name" }))
    .toHaveValue("Survives Sync");
});
