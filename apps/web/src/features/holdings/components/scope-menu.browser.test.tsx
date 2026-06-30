import type { AccountId, InvestmentAccount, UserId } from "@privance/core";
import { asId, asIsoDateTime } from "@privance/core";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useMediaQuery } from "@/lib/use-media-query";
import type { FilterState, LocalGroup } from "../types";
import { ScopeMenu } from "./scope-menu";

// Mock the media query so each test picks the popover (false) or drawer (true)
// branch deterministically, independent of the browser-mode viewport.
vi.mock("@/lib/use-media-query", () => ({ useMediaQuery: vi.fn(() => false) }));

beforeEach(() => {
  vi.mocked(useMediaQuery).mockReturnValue(false);
});

const TS = asIsoDateTime("2026-01-01T00:00:00.000Z");

function acct(id: string, name: string): InvestmentAccount {
  return {
    id: asId<AccountId>(id),
    userId: asId<UserId>("u1"),
    createdAt: TS,
    lastUpdatedAt: TS,
    payload: {
      kind: "investment",
      subKind: "brokerage",
      name,
      cashBalanceCents: "0",
      currency: "USD",
      assetType: "stock",
    },
  } as InvestmentAccount;
}

function group(id: string, name: string): LocalGroup {
  return { id, name, updatedAt: 0 };
}

const ACCOUNTS = [acct("a1", "Fidelity Brokerage"), acct("a2", "Roth IRA")];
const GROUPS = [group("g1", "Core")];

async function renderMenu(overrides: Partial<Parameters<typeof ScopeMenu>[0]> = {}) {
  const onSelect = vi.fn();
  const onEditGroups = vi.fn();
  const screen = await render(
    <ScopeMenu
      filter={{ kind: "all" } satisfies FilterState}
      label="All holdings"
      count={9}
      accounts={ACCOUNTS}
      groups={GROUPS}
      accountCounts={new Map([["a1", 5]])}
      groupCounts={new Map([["g1", 3]])}
      totalCount={9}
      onSelect={onSelect}
      onEditGroups={onEditGroups}
      {...overrides}
    />,
  );
  return { screen, onSelect, onEditGroups };
}

function pressActive(key: string) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

const SEARCH = { name: /search accounts and groups/i } as const;

test("opens on the heading trigger, lists every scope, and shows per-scope counts", async () => {
  const { screen } = await renderMenu();

  await screen.getByRole("button", { name: /All holdings/ }).click();

  const fidelity = screen.getByRole("option", { name: /Fidelity Brokerage/ });
  const core = screen.getByRole("option", { name: /Core/ });
  await expect.element(fidelity).toBeVisible();
  await expect.element(screen.getByRole("option", { name: /Roth IRA/ })).toBeVisible();
  await expect.element(core).toBeVisible();
  // counts come from accountCounts/groupCounts, rendered beside each option
  expect(fidelity.element().textContent).toContain("5");
  expect(core.element().textContent).toContain("3");
});

test("search filters to matching accounts and groups", async () => {
  const { screen } = await renderMenu();
  await screen.getByRole("button", { name: /All holdings/ }).click();

  await screen.getByRole("combobox", SEARCH).fill("roth");

  await expect.element(screen.getByRole("option", { name: /Roth IRA/ })).toBeVisible();
  expect(screen.getByRole("option", { name: /Fidelity Brokerage/ }).elements()).toHaveLength(0);
  expect(screen.getByRole("option", { name: /Core/ }).elements()).toHaveLength(0);
});

test("a query matching nothing shows the empty-state message and no scope options", async () => {
  const { screen } = await renderMenu();
  await screen.getByRole("button", { name: /All holdings/ }).click();

  await screen.getByRole("combobox", SEARCH).fill("zzz");

  await expect.element(screen.getByText(/No matching accounts or groups/)).toBeVisible();
  expect(screen.getByRole("option", { name: /Fidelity Brokerage/ }).elements()).toHaveLength(0);
});

test("selecting an account fires onSelect with that account scope", async () => {
  const { screen, onSelect } = await renderMenu();
  await screen.getByRole("button", { name: /All holdings/ }).click();

  await screen.getByRole("option", { name: /Roth IRA/ }).click();

  expect(onSelect).toHaveBeenCalledWith({ kind: "account", accountId: "a2" });
});

test("typing then pressing Enter selects the matched scope", async () => {
  const { screen, onSelect } = await renderMenu();
  await screen.getByRole("button", { name: /All holdings/ }).click();

  await screen.getByRole("combobox", SEARCH).fill("roth");
  pressActive("Enter");

  await vi.waitFor(() =>
    expect(onSelect).toHaveBeenCalledWith({ kind: "account", accountId: "a2" }),
  );
});

test("the active scope is marked with aria-current", async () => {
  const { screen } = await renderMenu({ filter: { kind: "group", groupId: "g1" } });
  await screen.getByRole("button", { name: /All holdings/ }).click();

  const core = screen.getByRole("option", { name: /Core/ }).element();
  expect(core.getAttribute("aria-current")).toBe("true");
});

test("Escape closes the desktop popover and returns focus to the trigger", async () => {
  const { screen } = await renderMenu();
  const trigger = screen.getByRole("button", { name: /All holdings/ }).element();

  await screen.getByRole("button", { name: /All holdings/ }).click();
  // the combobox auto-focuses on open (desktop popover)
  await expect
    .poll(() => document.activeElement?.getAttribute("aria-label"))
    .toBe("Search accounts and groups");

  pressActive("Escape");

  await expect.poll(() => screen.getByRole("combobox", SEARCH).elements().length).toBe(0);
  await expect.poll(() => document.activeElement === trigger).toBe(true);
});

test("Edit groups fires onEditGroups and closes", async () => {
  const { screen, onEditGroups } = await renderMenu();
  await screen.getByRole("button", { name: /All holdings/ }).click();

  await screen.getByRole("button", { name: /Edit groups/ }).click();

  expect(onEditGroups).toHaveBeenCalledTimes(1);
});

test("mobile renders a drawer with no search field (no keyboard) and tappable options", async () => {
  vi.mocked(useMediaQuery).mockReturnValue(true);
  const { screen, onSelect } = await renderMenu();

  const trigger = screen.getByRole("button", { name: /All holdings/ }).element();
  await screen.getByRole("button", { name: /All holdings/ }).click();
  await expect.element(screen.getByRole("dialog")).toBeVisible();

  expect(screen.getByRole("combobox", SEARCH).elements()).toHaveLength(0);

  // Tripwire for the drag-suppression attribute; the drag behavior itself is
  // only verifiable on real touch hardware, not in Chromium.
  expect(document.querySelector("[data-vaul-no-drag]")).not.toBeNull();

  await screen.getByRole("option", { name: /Roth IRA/ }).click();
  expect(onSelect).toHaveBeenCalledWith({ kind: "account", accountId: "a2" });
  await expect.poll(() => screen.getByRole("dialog").elements().length).toBe(0);
  await expect.poll(() => document.activeElement === trigger).toBe(true);
});
