import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { LocalSpendItem } from "../types";
import { SpendScreen } from "./spend-screen";
// Load the real stylesheet so a `veil-on` ancestor actually blurs `.vfig`.
import "@/app/globals.css";

// Mock the queries module to control what items are returned
vi.mock("../queries", () => ({
  useSpendItemsQuery: vi.fn(),
}));

// Mock the mutations module (no-ops for component tests)
vi.mock("../mutations", () => ({
  useSpendMutations: vi.fn(() => ({
    creating: false,
    updating: false,
    deleting: false,
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
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

test("split cards show subscription share and per-day, not annualized", async () => {
  // Equal active monthly in each group -> subscriptions are 50% of spend.
  mockQueryReturn([
    makeTestItem({ id: "1", name: "Rent", amountCents: "100000", group: "essentials" }),
    makeTestItem({
      id: "2",
      name: "Netflix",
      amountCents: "100000",
      category: "streaming",
      group: "subscriptions",
    }),
  ]);
  const screen = await render(<SpendScreen />);
  await expect.element(screen.getByText("Subs share")).toBeVisible();
  await expect.element(screen.getByText("50%")).toBeVisible();
  await expect.element(screen.getByText("Per day")).toBeVisible();
  expect(screen.getByText("Annualized").query()).toBeNull();
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
  await expect.element(screen.getByText("0 active · 1 paused")).toBeVisible();
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

test("yearly item shows the cadence, billed amount, and monthly equivalent", async () => {
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
  // Sub-line shows the cadence and the per-cycle billed amount ($139); the figure
  // shows the monthly equivalent ($139 / 12 = $11.58), never the raw $139.
  await expect.element(row).toHaveTextContent("billed yearly");
  await expect.element(row).toHaveTextContent("$139");
  await expect.element(row).toHaveTextContent("$11.58");
});

test("multi-unit cadence reads as 'every N units'", async () => {
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
  // $240 every 2 years = $120/yr = $10/mo.
  await expect.element(row).toHaveTextContent("billed every 2 years");
  await expect.element(row).toHaveTextContent("$240");
  await expect.element(row).toHaveTextContent("$10");
});

test("billed amount in the row sub-line is veil-blurred (no privacy leak)", async () => {
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
  // Render under a veil-on ancestor so the actual obscuring is observable: an
  // unblurred money figure would leak under the Veil.
  const screen = await render(
    <div className="veil-on">
      <SpendScreen />
    </div>,
  );
  const billed = [...screen.container.querySelectorAll(".vfig")].find((n) =>
    n.textContent?.includes("$139"),
  );
  expect(billed).toBeDefined();
  if (billed === undefined) throw new Error("billed figure not rendered");
  expect(getComputedStyle(billed).filter).toContain("blur");
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
  await expect.element(screen.getByText("$43.33")).toBeVisible();
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

test("clicking a row opens the edit dialog pre-populated with the item's values", async () => {
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
  await expect.element(screen.getByRole("heading", { name: "Edit Netflix" })).toBeVisible();
  // The Amount field is pre-filled from the stored cents ("1549" -> "15.49").
  await expect.element(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("15.49");
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
  await screen.getByText("Domain").click();
  await expect.element(screen.getByRole("heading", { name: "Edit Domain" })).toBeVisible();
  await expect.element(screen.getByRole("combobox", { name: "Interval unit" })).toHaveValue("year");
  await expect.element(screen.getByRole("textbox", { name: "Interval count" })).toHaveValue("2");
  await expect
    .element(screen.getByRole("radio", { name: "Subscriptions" }))
    .toHaveAttribute("aria-checked", "true");
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
  await expect.element(screen.getByRole("radiogroup", { name: "Status" })).toBeVisible();
});

test("status toggle absent in add mode", async () => {
  mockQueryReturn([makeTestItem({ id: "1", name: "Rent" })]);
  const screen = await render(<SpendScreen />);
  await screen.getByRole("button", { name: "+ Add expense" }).click();
  expect(screen.container.querySelector('[aria-label="Status"]')).toBeNull();
});
