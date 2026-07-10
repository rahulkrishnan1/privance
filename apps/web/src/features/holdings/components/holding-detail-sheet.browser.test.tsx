import { Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { LocalHolding } from "../types";
import { HoldingDetailSheet } from "./holding-detail-sheet";

function dec(cents: bigint): Decimal {
  return Decimal.fromMinorUnits(cents, SCALE_CENTS);
}

function makeHolding(overrides: Partial<LocalHolding> = {}): LocalHolding {
  return {
    id: "h-1",
    accountId: "acc-1",
    groupId: null,
    ticker: "VTI",
    assetType: "stock",
    proxyTicker: null,
    // 1000 shares at SCALE_CRYPTO (8dp)
    sharesMajor: "1000",
    sharesScale: 8,
    // cost basis = $315,886 = 31588600 cents
    costBasisCents: "31588600",
    scaleFactor: undefined,
    proxyAnchoredAt: undefined,
    name: "Vanguard Total Market",
    updatedAt: 0,
    ...overrides,
  };
}

// Price: $278.14 per share, stored as decimal string "278.14000000"
// 1000 shares * $278.14 = $278,140
const PRICE_MAP = new Map([["VTI", { ticker: "VTI", price: "278.14000000" }]]);
const EMPTY_PRICES = new Map<string, { ticker: string; price: string }>();

test("renders ticker, name, and market value", async () => {
  const screen = await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={PRICE_MAP}
      dayChangeCents={null}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  await expect.element(screen.getByText("VTI")).toBeVisible();
  await expect.element(screen.getByText("Vanguard Total Market")).toBeVisible();
  // Fixture: 1000 shares × $278.14 = $278,140.00. Assert the actual formatted value renders.
  const valueEl = document.querySelector('[data-testid="holding-detail-value"]');
  expect(valueEl).not.toBeNull();
  expect(valueEl?.textContent).toContain("278,140");
});

test("shows unrealized gain line when price and cost basis available", async () => {
  const screen = await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={PRICE_MAP}
      dayChangeCents={null}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  // Fixture: 1000 shares × $278.14 = $278,140 MV; cost = $315,886.
  // unrealizedGain = -$37,746.00; pct = -11.9%.
  // The source emits: formatCurrency(gain) + " (" + pct% + ") unrealized".
  // Since gain is negative, no "+" prefix; the formatted loss is "-$37,746.00".
  const gainLine = screen.getByText(/unrealized/);
  await expect.element(gainLine).toBeVisible();
  expect(gainLine.element().textContent).toContain("37,746");
  expect(gainLine.element().textContent).toContain("(-11.9%)");
  // Negative gain: no "+" sign at the start
  expect(gainLine.element().textContent).not.toMatch(/^\+/);
});

// Locate the Position "Day" row's value cell by its label sibling.
function dayValueText(container: Element): string {
  const labels = [...container.querySelectorAll("span")].filter((s) => s.textContent === "Day");
  const label = labels[0];
  if (label === undefined) throw new Error("Day row not found");
  const value = label.nextElementSibling;
  return value?.textContent ?? "";
}

test("Day row shows a positive day change with a plus sign and percent", async () => {
  // MV $278,140; +$2,000 today -> prior $276,140, +0.72%.
  await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={PRICE_MAP}
      dayChangeCents={dec(200000n)}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  const text = dayValueText(document.body);
  expect(text).toContain("+$2,000.00");
  expect(text).toContain("(+0.72%)");
});

test("Day row shows a negative day change with a minus sign and percent", async () => {
  // MV $278,140; -$2,000 today -> prior $280,140, -0.71%.
  await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={PRICE_MAP}
      dayChangeCents={dec(-200000n)}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  const text = dayValueText(document.body);
  expect(text).toContain("-$2,000.00");
  expect(text).toContain("(-0.71%)");
});

test("Day row shows a flat day change as +$0.00 without a misleading direction", async () => {
  await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={PRICE_MAP}
      dayChangeCents={dec(0n)}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  const text = dayValueText(document.body);
  expect(text).toContain("$0.00");
  expect(text).toContain("0.00%");
});

test("renders position KV rows: Quantity, Price, Cost basis, Portfolio weight, Account", async () => {
  const totalInvestments = dec(100000000n); // $1,000,000
  const screen = await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={PRICE_MAP}
      dayChangeCents={null}
      totalInvestmentsCents={totalInvestments}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  // Use getByText with exact regex anchors to avoid matching the muted note text
  await expect.element(screen.getByText(/^Quantity$/)).toBeVisible();
  await expect.element(screen.getByText(/^Price$/)).toBeVisible();
  await expect.element(screen.getByText(/^Total cost basis$/)).toBeVisible();
  await expect.element(screen.getByText(/^Portfolio weight$/)).toBeVisible();
  await expect.element(screen.getByText(/^Account$/)).toBeVisible();
  await expect.element(screen.getByText("Vanguard Brokerage")).toBeVisible();
});

test("shows no-price state when price not available", async () => {
  const screen = await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={EMPTY_PRICES}
      dayChangeCents={null}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  await expect.element(screen.getByText(/no price, set one/)).toBeVisible();
});

test("two-tap delete: first tap shows Tap again to delete, second calls onDelete", async () => {
  vi.useFakeTimers();
  const onDelete = vi.fn(() => Promise.resolve());
  const screen = await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={EMPTY_PRICES}
      dayChangeCents={null}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={onDelete}
    />,
  );

  // First tap: arm the delete
  await screen.getByRole("button", { name: "Delete" }).click();
  await expect.element(screen.getByRole("button", { name: "Tap again to delete" })).toBeVisible();
  expect(onDelete).not.toHaveBeenCalled();

  // Second tap: execute
  await screen.getByRole("button", { name: "Tap again to delete" }).click();
  await vi.waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));

  vi.useRealTimers();
});

test("Edit holding button calls onEdit with the holding", async () => {
  const onEdit = vi.fn();
  const holding = makeHolding();
  const screen = await render(
    <HoldingDetailSheet
      holding={holding}
      prices={EMPTY_PRICES}
      dayChangeCents={null}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={() => {}}
      onEdit={onEdit}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  await screen.getByRole("button", { name: "Edit holding" }).click();
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onEdit).toHaveBeenCalledWith(holding);
});

test("Close button calls onClose", async () => {
  const onClose = vi.fn();
  const screen = await render(
    <HoldingDetailSheet
      holding={makeHolding()}
      prices={EMPTY_PRICES}
      dayChangeCents={null}
      totalInvestmentsCents={null}
      accountName="Vanguard Brokerage"
      onClose={onClose}
      onEdit={() => {}}
      onDelete={vi.fn(() => Promise.resolve())}
    />,
  );

  await screen.getByRole("button", { name: "Close holding details" }).click();
  expect(onClose).toHaveBeenCalledTimes(1);
});
