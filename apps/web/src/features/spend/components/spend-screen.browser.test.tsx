import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { LocalSpendItem } from "../types";
import { SpendScreen } from "./spend-screen";
// Load the real stylesheet so a `veil-on` ancestor actually blurs `.vfig`.
import "@/app/globals.css";

// Mock the queries module to control what items are returned
vi.mock("../queries", () => ({
  useSpendItemsQuery: vi.fn(),
}));

const mutationMocks = vi.hoisted(() => ({ deleteItem: vi.fn() }));

// Mock the mutations module (no-ops for component tests)
vi.mock("../mutations", () => ({
  useSpendMutations: vi.fn(() => ({
    creating: false,
    updating: false,
    deleting: false,
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: mutationMocks.deleteItem,
  })),
}));

const tick = vi.fn();
vi.mock("@/providers", () => ({ useSync: () => ({ tick }) }));

import { useSpendItemsQuery } from "../queries";

const mockQuery = vi.mocked(useSpendItemsQuery);

function makeTestItem(overrides: Partial<LocalSpendItem> = {}): LocalSpendItem {
  return {
    id: "item-1",
    name: "Rent",
    amountCents: "145000",
    intervalCount: 1,
    intervalUnit: "month",
    category: "housing",
    group: "essentials",
    nextRenewalAt: undefined,
    status: "active",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function mockQueryReturn(items: LocalSpendItem[]) {
  mockQuery.mockReturnValue({ items, loading: false, error: null });
}

test("empty state renders heading and CTA button", async () => {
  mockQueryReturn([]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("Nothing recurring,")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Add a recurring expense" }))
    .toBeVisible();
});

test("populated state renders both group panels", async () => {
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Rent", amountCents: "145000", group: "essentials" }),
    makeTestItem({
      id: "2",
      name: "Netflix",
      amountCents: "1549",
      category: "streaming",
      group: "subscriptions",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByRole("heading", { name: "Essentials" })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Subscriptions" })).toBeVisible();
  await expect.element(screen.getByText("Rent")).toBeVisible();
  await expect.element(screen.getByText("Netflix")).toBeVisible();
});

test("keeps expense details mounted through the edit close transition", async () => {
  mockQueryReturn([makeTestItem()]);
  const screen = await render(<SpendScreen />);

  await screen.getByRole("button", { name: /Rent/ }).click();
  const details = screen.getByRole("dialog", { name: "Rent" });
  await expect.element(details).toBeVisible();
  await details.getByRole("button", { name: "Edit expense" }).click();

  const editDialog = screen.getByRole("dialog", { name: "Edit Rent" });
  await expect.poll(() => details.element().hasAttribute("data-ending-style")).toBe(true);
  expect(editDialog.query()).toBeNull();
  await expect.poll(() => details.element().hasAttribute("data-ending-style")).toBe(false);
  await expect.element(editDialog).toBeVisible();
  await editDialog.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => editDialog.query()).toBeNull();
});

test("category panel matches Invest allocation rows and expands one category at a time", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Rent",
      amountCents: "100000",
      group: "essentials",
      nextRenewalAt: "2099-10-01",
    }),
    makeTestItem({
      id: "2",
      name: "Netflix",
      amountCents: "10000",
      category: "streaming",
      group: "subscriptions",
      nextRenewalAt: "2099-10-02",
    }),
  ]);
  const screen = await render(<SpendScreen />);

  await expect.element(screen.getByRole("heading", { name: "By category" })).toBeVisible();
  await expect.element(screen.getByText("90.91%")).toBeVisible();

  const housing = screen.getByRole("button", { name: /Housing \$1,000\/mo/ });
  const streaming = screen.getByRole("button", { name: /Streaming \$100\/mo/ });
  const bar = screen.getByRole("img", { name: "Category spend allocation bar" });
  const housingSegment = bar.element().querySelectorAll("span").item(0);
  const streamingSegment = bar.element().querySelectorAll("span").item(1);
  if (!housingSegment || !streamingSegment) throw new Error("expected two allocation segments");
  const housingRow = housing.element().closest("li");
  const streamingRow = streaming.element().closest("li");
  const opacity = (element: Element | null) =>
    element ? getComputedStyle(element).opacity : "missing";
  const background = (element: Element | null) =>
    element ? getComputedStyle(element).backgroundColor : "missing";

  await housing.hover();
  await expect.poll(() => background(housingRow)).not.toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => getComputedStyle(housingSegment).opacity).toBe("1");
  await expect.poll(() => opacity(streamingRow)).toBe("0.5");
  await expect.poll(() => getComputedStyle(streamingSegment).opacity).toBe("0.5");

  await userEvent.hover(streamingSegment);
  await expect.poll(() => background(streamingRow)).not.toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => opacity(housingRow)).toBe("0.5");
  await expect.poll(() => getComputedStyle(housingSegment).opacity).toBe("0.5");

  await screen.getByRole("heading", { name: "By category" }).hover();
  await expect.poll(() => background(housingRow)).toBe("rgba(0, 0, 0, 0)");
  await expect.poll(() => getComputedStyle(housingSegment).opacity).toBe("1");
  await expect.poll(() => opacity(streamingRow)).toBe("1");

  housing.element().focus();
  await expect.poll(() => getComputedStyle(housingSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(streamingSegment).opacity).toBe("0.5");
  housing.element().blur();
  await expect.poll(() => getComputedStyle(streamingSegment).opacity).toBe("1");

  await housing.click();
  await expect.element(housing).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("due Oct 1, 2099", { exact: true }).last()).toBeVisible();
  await screen.getByRole("heading", { name: "By category" }).hover();
  await expect.poll(() => getComputedStyle(housingSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(streamingSegment).opacity).toBe("0.5");
  housing.element().blur();
  await expect.poll(() => getComputedStyle(housingSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(streamingSegment).opacity).toBe("0.5");

  await streaming.click();
  await expect.element(streaming).toHaveAttribute("aria-expanded", "true");
  await expect.element(housing).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => getComputedStyle(streamingSegment).opacity).toBe("1");
  await expect
    .element(screen.getByText("renews Oct 2, 2099", { exact: true }).last())
    .toBeVisible();
  await streaming.click();
  await screen.getByRole("heading", { name: "By category" }).hover();
  await expect.poll(() => getComputedStyle(housingSegment).opacity).toBe("1");
  await expect.poll(() => getComputedStyle(streamingSegment).opacity).toBe("1");
});

test("summary cards show the group split and next upcoming bill", async () => {
  // Equal active monthly in each group -> subscriptions are 50% of spend.
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Rent",
      amountCents: "100000",
      group: "essentials",
      nextRenewalAt: "2099-10-01",
    }),
    makeTestItem({
      id: "2",
      name: "Netflix",
      amountCents: "100000",
      category: "streaming",
      group: "subscriptions",
      nextRenewalAt: "2099-10-02",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("Subs share")).toBeVisible();
  await expect.element(screen.getByText("50%")).toBeVisible();
  await expect.element(screen.getByText("Next bill")).toBeVisible();
  await expect.element(screen.getByText("Due Oct 1, 2099", { exact: true })).toBeVisible();
  expect(screen.getByText("Annualized").query()).toBeNull();
});

test("next bill card asks for a date when active expenses are undated", async () => {
  mockQueryReturn([makeTestItem({ id: "1", name: "Rent" })]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("Next bill")).toBeVisible();
  await expect.element(screen.getByText("Set a date to see upcoming bills")).toBeVisible();
});

test("next bill card says there are no upcoming bills when nothing is active", async () => {
  mockQueryReturn([makeTestItem({ id: "1", name: "Paused gym", status: "paused" })]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("No upcoming bills")).toBeVisible();
});

test("rows within a panel are sorted by monthly value, highest first", async () => {
  // Inserted out of order; the panel must render Pricey ($2,000/mo) > Mid
  // ($500/mo) > Cheap ($10/mo) regardless of input order.
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Cheap", amountCents: "1000", group: "essentials" }),
    makeTestItem({ id: "2", name: "Pricey", amountCents: "200000", group: "essentials" }),
    makeTestItem({ id: "3", name: "Mid", amountCents: "50000", group: "essentials" }),
  ]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("Pricey")).toBeVisible();
  const order = [...screen.container.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .filter((t) => /Pricey|Mid|Cheap/.test(t));
  expect(order.findIndex((t) => t.includes("Pricey"))).toBeLessThan(
    order.findIndex((t) => t.includes("Mid")),
  );
  expect(order.findIndex((t) => t.includes("Mid"))).toBeLessThan(
    order.findIndex((t) => t.includes("Cheap")),
  );
});

test("an item is placed by its group, not its category", async () => {
  // Restaurants/food explicitly grouped as essentials must land in the Essentials
  // panel, proving the panel follows the user-chosen group, not the category.
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Restaurants", category: "food", group: "essentials" }),
  ]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("Restaurants")).toBeVisible();
  // Only the Essentials panel renders. Panel titles are level-3 headings; the
  // always-on split cards above use plain text, so querying h3 by role isolates
  // the panels.
  await expect.element(screen.getByRole("heading", { level: 3, name: "Essentials" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 3, name: "Subscriptions" }).query()).toBeNull();
});

test("paused items are excluded from the monthly total", async () => {
  // Active Rent $1000/mo, paused Gym $500/mo. The headline total must be $1,000,
  // not $1,500: the paused item is listed but never counted.
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Rent", amountCents: "100000", group: "essentials" }),
    makeTestItem({
      id: "2",
      name: "Gym",
      amountCents: "50000",
      category: "fitness",
      group: "subscriptions",
      status: "paused",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("Gym")).toBeVisible();
  await expect.element(screen.getByText("paused", { exact: true })).toBeVisible();
  const total = screen.getByTestId("spend-monthly-total");
  await expect.element(total).toHaveTextContent("$1,000");
  await expect.element(total).not.toHaveTextContent("$1,500");
  // The subscriptions subtotal reflects the active/paused split.
  await expect.element(screen.getByText("0 active, 1 paused")).toBeVisible();
});

test("paused item row swaps the cadence sub-line for a resume hint", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Disney+",
      amountCents: "1399",
      category: "streaming",
      group: "subscriptions",
      status: "paused",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("paused", { exact: true })).toBeVisible();
  await expect.element(screen.getByText(/resumes when you do/)).toBeVisible();
});

test("yearly item keeps the per-cycle amount out of the regular row", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Prime",
      amountCents: "13900",
      category: "shopping",
      group: "subscriptions",
      intervalUnit: "year",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  const row = screen.getByRole("button", { name: /Prime/ });
  // The regular row shows the comparable monthly figure, not the per-cycle yearly amount.
  await expect.element(row).not.toHaveTextContent("$139/yr");
  await expect.element(row).toHaveTextContent("$11.58");
});

test("multi-unit cadence keeps the per-cycle amount out of the regular row", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Domain",
      amountCents: "24000",
      category: "software",
      group: "subscriptions",
      intervalCount: 2,
      intervalUnit: "year",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  const row = screen.getByRole("button", { name: /Domain/ });
  // $240 every 2 years = $120/yr = $10/mo; the regular row only shows the comparable monthly figure.
  await expect.element(row).not.toHaveTextContent("$240/2yr");
  await expect.element(row).toHaveTextContent("$10");
});

test("regular rows show the next bill date without the per-cycle amount", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Prime",
      amountCents: "13900",
      category: "shopping",
      group: "subscriptions",
      intervalUnit: "year",
      nextRenewalAt: "2099-03-15",
    }),
    makeTestItem({
      id: "2",
      name: "Domain",
      amountCents: "13900",
      category: "software",
      group: "subscriptions",
      intervalUnit: "year",
      nextRenewalAt: undefined,
    }),
  ]);
  const screen = await render(<SpendScreen />);
  // Dated: verb + always-year date, without the per-cycle amount.
  await expect
    .element(screen.getByRole("button", { name: /Prime/ }))
    .toHaveTextContent("renews Mar 15, 2099");
  await expect
    .element(screen.getByRole("button", { name: /Prime/ }))
    .not.toHaveTextContent("$139/yr");
  // Dateless: no orphaned per-cycle amount is rendered.
  const dateless = screen.getByRole("button", { name: /Domain/ });
  await expect.element(dateless).not.toHaveTextContent("$139/yr");
});

test("category stays in the row accessible name for screen readers", async () => {
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Rent", category: "housing", group: "essentials" }),
  ]);
  const screen = await render(<SpendScreen />);
  // The category icon is aria-hidden, so the category label lives in an sr-only span.
  await expect.element(screen.getByRole("button", { name: /Rent.*Housing/i })).toBeVisible();
});

test("yearly billed amount is only shown after opening details", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Prime",
      amountCents: "13900",
      category: "shopping",
      group: "subscriptions",
      intervalUnit: "year",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  const row = screen.getByRole("button", { name: /Prime/ });
  await expect.element(row).not.toHaveTextContent("$139/yr");
  await row.click();
  const detail = screen.getByRole("dialog", { name: "Prime" });
  await expect.element(detail.getByTestId("spend-detail-amount")).toHaveTextContent("$139/year");
  await expect.element(detail).toHaveTextContent("Every year");
});

test("weekly item renders the rounded monthly equivalent ($43.33)", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Locker",
      amountCents: "1000",
      category: "fitness",
      group: "subscriptions",
      intervalUnit: "week",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  // $10/week * 52 / 12 = $43.33 (banker rounding), shown with cents.
  const row = screen.getByRole("button", { name: /Locker/ });
  await expect.element(row).toHaveTextContent("$43.33");
  // The regular row omits the per-cycle amount; open the item to see its cadence.
  await expect.element(row).not.toHaveTextContent("$10/wk");
});

test("cadence units render with a tight slash across the overview and rows", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Rent",
      amountCents: "150000",
      category: "housing",
      group: "essentials",
      intervalUnit: "month",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  const text = (screen.container.textContent ?? "").replace(/\s+/g, " ");
  // Hero spells out the period, slash tight against the figure.
  expect(text).toContain("$1,500/month");
  // The annual equivalent appears once in the headline context.
  expect(text).toContain("$18,000/year");
  // The compact item row keeps the abbreviation, same tight slash.
  await expect.element(screen.getByRole("button", { name: /Rent/ })).toHaveTextContent("$1,500/mo");
  // Guards the spacing: no figure may render the spaced "$1,500 / mo" form.
  expect(text).not.toMatch(/ \/ /);
});

test("sub-line shows 'due' for essentials and 'renews' for subscriptions with the next bill date", async () => {
  // Far-future anchors stay put (no roll-forward), so the rendered date is stable.
  // A non-current year is shown in full.
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Rent", group: "essentials", nextRenewalAt: "2099-05-01" }),
    makeTestItem({
      id: "2",
      name: "Netflix",
      category: "streaming",
      group: "subscriptions",
      nextRenewalAt: "2099-05-22",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await expect
    .element(screen.getByRole("button", { name: /Rent/ }))
    .toHaveTextContent("due May 1, 2099");
  await expect
    .element(screen.getByRole("button", { name: /Netflix/ }))
    .toHaveTextContent("renews May 22, 2099");
});

test("a past anchor rolls forward: a monthly bill never shows a date in the past", async () => {
  // Anchor years ago; the displayed next bill must be today or later, never 2020.
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Rent", group: "essentials", nextRenewalAt: "2020-01-09" }),
  ]);
  const screen = await render(<SpendScreen />);
  const row = screen.getByRole("button", { name: /Rent/ });
  await expect.element(row).toHaveTextContent("due");
  await expect.element(row).not.toHaveTextContent("2020");
});

test("loading state shows neither the empty state nor the total", async () => {
  mockQuery.mockReturnValue({ items: [], loading: true, error: null });
  const screen = await render(<SpendScreen />);
  expect(screen.container.querySelector('[data-testid="spend-monthly-total"]')).toBeNull();
  expect(screen.container.textContent).not.toContain("Nothing recurring");
});

test("error state shows an alert and Retry re-runs the query", async () => {
  tick.mockClear();
  mockQuery.mockReturnValue({
    items: [],
    loading: false,
    error: new Error("DB unavailable"),
  });
  const screen = await render(<SpendScreen />);
  const alert = screen.getByRole("alert");
  await expect.element(alert).toHaveTextContent("Failed to load.");
  await expect.element(alert).toHaveTextContent("DB unavailable");
  await screen.getByRole("button", { name: "Retry" }).click();
  expect(tick).toHaveBeenCalledTimes(1);
});

test("Add button opens spend-form dialog", async () => {
  mockQueryReturn([makeTestItem({ id: "1", name: "Rent" })]);
  const screen = await render(<SpendScreen />);
  await screen.getByRole("button", { name: "+ Add expense" }).click();
  await expect.element(screen.getByRole("heading", { name: "Add expense" })).toBeVisible();
});

test("add form exposes the group toggle", async () => {
  mockQueryReturn([makeTestItem({ id: "1", name: "Rent" })]);
  const screen = await render(<SpendScreen />);
  await screen.getByRole("button", { name: "+ Add expense" }).click();
  await expect.element(screen.getByRole("radiogroup", { name: "Group" })).toBeVisible();
});

test("clicking a row opens read-only details before edit", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Netflix",
      amountCents: "1549",
      category: "streaming",
      group: "subscriptions",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await screen.getByText("Netflix").click();
  const detail = screen.getByRole("dialog", { name: "Netflix" });
  await expect.element(screen.getByRole("heading", { name: "Netflix" })).toBeVisible();
  await expect.element(detail).toHaveTextContent("Streaming");
  await expect.element(detail).toHaveTextContent("Active");
  await expect.element(detail.getByTestId("spend-detail-amount")).toHaveTextContent("$15.49/month");
  expect(detail).not.toHaveTextContent("Monthly equivalent");
  expect(detail).not.toHaveTextContent("Annual equivalent");
  expect(screen.getByRole("textbox", { name: "Amount" }).query()).toBeNull();
  await expect.element(screen.getByRole("button", { name: "Edit expense" })).toBeVisible();
});

test("shows a deletion error and keeps expense details open when delete fails", async () => {
  mockQueryReturn([makeTestItem({ id: "1", name: "Rent" })]);
  mutationMocks.deleteItem.mockRejectedValueOnce(new Error("delete failed"));
  const screen = await render(<SpendScreen />);

  await screen.getByRole("button", { name: /Rent/ }).click();
  const detail = screen.getByRole("dialog", { name: "Rent" });
  await detail.getByRole("button", { name: "Delete" }).click();
  await detail.getByRole("button", { name: "Tap again to delete" }).click();

  await expect
    .element(detail.getByRole("alert"))
    .toHaveTextContent("Couldn't delete this expense. Please try again.");
  await expect.element(detail).toBeVisible();
});

test("a pending delete for an old expense does not close the newly selected expense", async () => {
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Rent" }),
    makeTestItem({ id: "2", name: "Netflix", category: "streaming", group: "subscriptions" }),
  ]);
  let resolveDelete: () => void = () => {};
  mutationMocks.deleteItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveDelete = () => resolve();
      }),
  );
  const screen = await render(<SpendScreen />);

  await screen.getByRole("button", { name: /Rent/ }).click();
  const rentDetail = screen.getByRole("dialog", { name: "Rent" });
  await rentDetail.getByRole("button", { name: "Delete" }).click();
  await rentDetail.getByRole("button", { name: "Tap again to delete" }).click();
  expect(mutationMocks.deleteItem).toHaveBeenCalledWith("1");

  await rentDetail.getByRole("button", { name: "Close expense details" }).click();
  await screen.getByRole("button", { name: /Netflix/ }).click();
  const netflixDetail = screen.getByRole("dialog", { name: "Netflix" });
  await expect.element(netflixDetail).toBeVisible();

  resolveDelete();
  await expect.element(netflixDetail).toBeVisible();
});

test("paused expense details do not present its old date as a scheduled bill", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Paused gym",
      category: "fitness",
      group: "essentials",
      status: "paused",
      nextRenewalAt: "2099-10-01",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await screen.getByText("Paused gym").click();
  const detail = screen.getByRole("dialog", { name: "Paused gym" });
  await expect.element(detail).toHaveTextContent("Not scheduled");
  await expect.element(detail).not.toHaveTextContent("Oct 1, 2099");
  await detail.getByRole("button", { name: "Close expense details" }).click();
  await expect.poll(() => detail.query()).toBeNull();
});

test("edit dialog pre-populates cadence, interval count, and group from the item", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Domain",
      amountCents: "24000",
      category: "software",
      group: "subscriptions",
      intervalCount: 2,
      intervalUnit: "year",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await screen.getByRole("button", { name: /Domain/ }).click();
  const details = screen.getByRole("dialog", { name: "Domain" });
  await expect.element(details).toBeVisible();
  await details.getByRole("button", { name: "Edit expense" }).click();
  const editDialog = screen.getByRole("dialog", { name: "Edit Domain" });
  await expect.element(editDialog).toBeVisible();
  await expect
    .element(editDialog.getByRole("combobox", { name: "Interval unit" }))
    .toHaveValue("year");
  await expect
    .element(editDialog.getByRole("textbox", { name: "Interval count" }))
    .toHaveValue("2");
  await expect
    .element(editDialog.getByRole("radio", { name: "Subscriptions" }))
    .toHaveAttribute("aria-checked", "true");
  await editDialog.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => editDialog.query()).toBeNull();
});

test("in add mode, choosing a category auto-selects its default group", async () => {
  mockQueryReturn([makeTestItem({ id: "1", name: "Rent" })]);
  const screen = await render(<SpendScreen />);
  await screen.getByRole("button", { name: "+ Add expense" }).click();
  await expect.element(screen.getByRole("heading", { name: "Add expense" })).toBeVisible();
  const category = screen.getByRole("combobox", { name: "Category" });
  // A subscriptions-default category flips the group off the essentials default.
  await category.selectOptions("streaming");
  await expect
    .element(screen.getByRole("radio", { name: "Subscriptions" }))
    .toHaveAttribute("aria-checked", "true");
  // An essentials-default category flips it back.
  await category.selectOptions("housing");
  await expect
    .element(screen.getByRole("radio", { name: "Essentials" }))
    .toHaveAttribute("aria-checked", "true");
});

test("status toggle present in edit mode", async () => {
  mockQueryReturn([
    makeTestItem({
      id: "1",
      name: "Spotify",
      amountCents: "999",
      category: "music",
      group: "subscriptions",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await screen.getByText("Spotify").click();
  await screen.getByRole("button", { name: "Edit expense" }).click();
  await expect.element(screen.getByRole("radiogroup", { name: "Status" })).toBeVisible();
});

test("status toggle absent in add mode", async () => {
  mockQueryReturn([makeTestItem({ id: "1", name: "Rent" })]);
  const screen = await render(<SpendScreen />);
  await screen.getByRole("button", { name: "+ Add expense" }).click();
  expect(screen.container.querySelector('[aria-label="Status"]')).toBeNull();
});
