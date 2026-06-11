import type { Account, AccountId, UserId } from "@privance/core";
import { asId, asIsoDateTime, Decimal, SCALE_CENTS } from "@privance/core";
import type { SimulateResult, YearBand } from "@privance/core/projection";
import { deriveAllocationParams } from "@privance/core/projection";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// ---------------------------------------------------------------------------
// Hoisted holders for mock state
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  accounts: { status: "success", data: [] as unknown[] },
  planRecord: { status: "none" } as {
    status: "none" | "initialising" | "success" | "error";
    data?: unknown;
    error?: Error;
  },
  holdings: [] as unknown[],
  prices: new Map<string, Decimal>(),
  simulateResult: null as SimulateResult | null,
  simulateDelay: 0,
  savePlanMock: vi.fn(async (_payload: unknown) => {}),
}));

// ---------------------------------------------------------------------------
// Mocks (must be before imports)
// ---------------------------------------------------------------------------

vi.mock("./queries", () => ({
  usePlanRecord: () => h.planRecord,
}));

vi.mock("./mutations", () => ({
  useSavePlan: () => ({
    savePlan: h.savePlanMock,
    state: "idle",
    error: null,
  }),
}));

vi.mock("@/features/accounts/queries", async () => {
  const { centsToDecimal, getBalanceCents } = await import("@/features/accounts/balance");
  return { useAccountsQuery: () => h.accounts, centsToDecimal, getBalanceCents };
});

vi.mock("@/features/holdings/queries", () => ({
  useHoldingsQuery: () => ({ holdings: h.holdings, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock("@/lib/queries/prices", () => ({
  usePricesQuery: () => ({ prices: h.prices, previousPrices: new Map() }),
}));

vi.mock("@/lib/sim/worker-client", () => ({
  simulate: vi.fn(async (input: unknown) => {
    if (h.simulateDelay > 0) {
      await new Promise((r) => setTimeout(r, h.simulateDelay));
    }
    if (h.simulateResult !== null) return h.simulateResult;
    return buildDefaultResult(input as { currentAge: number; planUntilAge: number });
  }),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import { LeversSection } from "./components/levers-section";
import { PlanScreen } from "./plan-screen";
import type { PlanFormValues } from "./types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const NOW = asIsoDateTime("2024-01-01T00:00:00.000Z");

function makeCashAccount(
  id: string,
  name: string,
  balanceCents: string,
  currency = "USD",
): Account {
  return {
    id: asId<AccountId>(id),
    userId: asId<UserId>("u1"),
    createdAt: NOW,
    lastUpdatedAt: NOW,
    payload: { kind: "cash", subKind: "checking", name, balanceCents, currency },
  } as Account;
}

function makeManualAsset(id: string, name: string, valueCents: string, currency = "USD"): Account {
  return {
    id: asId<AccountId>(id),
    userId: asId<UserId>("u1"),
    createdAt: NOW,
    lastUpdatedAt: NOW,
    payload: { kind: "manual_asset", subKind: "real_estate", name, valueCents, currency },
  } as Account;
}

function toCents(dollars: number): Decimal {
  return Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS);
}

function makeBand(p10: number, p25: number, p50: number, p75: number, p90: number): YearBand {
  return {
    p10: toCents(p10),
    p25: toCents(p25),
    p50: toCents(p50),
    p75: toCents(p75),
    p90: toCents(p90),
  };
}

function buildDefaultResult(input: { currentAge?: number; planUntilAge?: number }): SimulateResult {
  const horizon = Math.max((input.planUntilAge ?? 65) - (input.currentAge ?? 35), 1);
  const bands: YearBand[] = Array.from({ length: horizon }, (_, i) =>
    makeBand(
      50_000 + i * 5_000,
      80_000 + i * 8_000,
      120_000 + i * 12_000,
      160_000 + i * 16_000,
      200_000 + i * 20_000,
    ),
  );
  return {
    fireNumber: toCents(1_000_000),
    mc: {
      successRate: 0.87,
      neverFiFraction: 0.03,
      medianFireAge: 52,
      pathCount: 100,
      yearlyBands: bands,
    },
    replay: {
      survivalShare: 0.91,
      excludedWindowCount: 5,
      completeWindowCount: 90,
      worstCohorts: [
        { startYear: 1966, depletionAge: 78 },
        { startYear: 1929, depletionAge: 81 },
      ],
    },
  };
}

// Fill minimum inputs using aria labels via the Input component.
// The Input component renders: <label>{label}</label><input aria-label implied by htmlFor>
// So getByRole("textbox", {name: ...}) works for number inputs.
async function fillMinimumInputs(
  screen: Awaited<ReturnType<typeof render>>,
  opts: { age?: number; planUntilAge?: number; spend?: number; swr?: number } = {},
) {
  const age = opts.age ?? 35;
  const planUntil = opts.planUntilAge ?? 65;
  const spend = opts.spend ?? 40000;
  const swr = opts.swr ?? 4;

  await screen.getByRole("textbox", { name: "Current age" }).fill(String(age));
  await screen.getByRole("textbox", { name: "Plan until age" }).fill(String(planUntil));
  await screen.getByRole("textbox", { name: "Target annual spend" }).fill(String(spend));
  await screen.getByRole("textbox", { name: "Withdrawal rate" }).fill(String(swr));
}

// ---------------------------------------------------------------------------
// AE1: Accounts present, no plan -> pre-filled pot visible, results placeholder
// ---------------------------------------------------------------------------

test("AE1: accounts present and no plan shows pre-filled pot and results placeholder", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "500000")] }; // $5,000
  h.planRecord = { status: "none" };

  const screen = await render(<PlanScreen />);

  // Pre-filled pot displayed in the assumptions bar (expanded, visible in pot note).
  await expect.element(screen.getByTestId("starting-pot")).toBeVisible();
  const potText = screen.getByTestId("starting-pot").element().textContent ?? "";
  expect(potText).toContain("$");
  expect(potText).toContain("5,000");

  // Results placeholder visible (no chart yet, no fire-age-value).
  expect(screen.container.querySelector("[data-testid='fire-age-value']")).toBeNull();
  await expect.element(screen.getByText(/enter your annual spend/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// AE7: Manual-asset-only user sees zero pot
// ---------------------------------------------------------------------------

test("AE7: manual-asset-only user sees zero pot in starting portfolio", async () => {
  h.accounts = {
    status: "success",
    data: [makeManualAsset("m1", "My Property", "50000000")],
  };
  h.planRecord = { status: "none" };

  const screen = await render(<PlanScreen />);

  await expect.element(screen.getByTestId("starting-pot")).toBeVisible();
  const potText = screen.getByTestId("starting-pot").element().textContent ?? "";
  // Manual assets are excluded from pot; pot should be $0.
  expect(potText).toContain("$0");

  // R1: the excluded value is shown as context, not silently dropped.
  await expect.element(screen.getByTestId("pot-context")).toBeVisible();
  const contextText = screen.getByTestId("pot-context").element().textContent ?? "";
  expect(contextText).toContain("$500,000.00");
  expect(contextText).toContain("manual assets");
});

// ---------------------------------------------------------------------------
// AE8: Pot above FIRE target -> financially-independent-today headline
// ---------------------------------------------------------------------------

test("AE8: pot >= FIRE number shows financially-independent-today state", async () => {
  h.accounts = {
    status: "success",
    data: [makeCashAccount("c1", "Brokerage", "150000000")], // $1,500,000
  };
  h.planRecord = { status: "none" };
  h.simulateResult = {
    fireNumber: toCents(1_000_000),
    mc: {
      successRate: 0.97,
      neverFiFraction: 0,
      medianFireAge: 35,
      pathCount: 100,
      yearlyBands: [makeBand(1_500_000, 1_600_000, 1_700_000, 1_800_000, 1_900_000)],
    },
    replay: {
      survivalShare: 0.98,
      excludedWindowCount: 0,
      completeWindowCount: 90,
      worstCohorts: [],
    },
  };

  const screen = await render(<PlanScreen />);

  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 44, planUntilAge: 95 });

  await vi.waitFor(
    () => {
      const text = screen.container.textContent ?? "";
      if (!text.toLowerCase().includes("financially independent")) {
        throw new Error("FI headline not visible yet");
      }
    },
    { timeout: 5_000 },
  );

  // Headline contains "today" (alreadyFi state: "You're financially independent today.")
  expect(screen.container.textContent?.toLowerCase()).toContain("financially independent");
  expect(screen.container.textContent?.toLowerCase()).toContain("today");

  // Facts line contains the FIRE target
  expect(screen.container.textContent).toContain("$1,000,000");

  // alreadyFi state has no fire-age-value node
  expect(screen.container.querySelector("[data-testid='fire-age-value']")).toBeNull();
});

// ---------------------------------------------------------------------------
// AE11: the strategy allocation slider; contribution has label
// ---------------------------------------------------------------------------

test("AE11: the strategy allocation slider shows the live stock/bond split", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };

  const screen = await render(<PlanScreen />);

  // The strategy slider is the single allocation knob in the Adjust panel.
  const slider = screen.getByRole("slider", { name: "Stock allocation percent" });
  await expect.element(slider).toBeVisible();
  // Defaults to the 60/40 balanced mix; aria-valuetext reflects the live split
  // so the value is observable, not just the control's presence.
  expect((slider.element() as HTMLInputElement).value).toBe("60");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "60% stocks, 40% bonds");
});

test("AE11: moving the strategy slider feeds derived return params into the simulation", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = null;

  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;
  mockFn.mockClear();

  const screen = await render(<PlanScreen />);
  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 35, planUntilAge: 65 });

  // Drive the range input the way React listens for it (native value setter +
  // bubbling input event); Playwright cannot .fill() a range input.
  const slider = screen.getByRole("slider", { name: "Stock allocation percent" });
  const el = slider.element() as HTMLInputElement;
  const setRangeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setRangeValue?.call(el, "80");
  el.dispatchEvent(new Event("input", { bubbles: true }));

  await expect.element(slider).toHaveAttribute("aria-valuetext", "80% stocks, 20% bonds");

  // The 80% mix must reach the simulation as the dataset-derived mu/sigma, not a
  // stale 60% default or a hard-coded number.
  const expected = deriveAllocationParams(0.8);
  await vi.waitFor(
    () => {
      const calls = mockFn.mock.calls as Array<
        [{ stockWeight: number; muBps: number; sigmaBps: number }]
      >;
      const hit = calls.find((c) => c[0]?.stockWeight === 0.8);
      if (hit === undefined) throw new Error("no simulate call for the 80% mix yet");
      expect(hit[0].muBps).toBe(expected.muBps);
      expect(hit[0].sigmaBps).toBe(expected.sigmaBps);
    },
    { timeout: 5_000 },
  );
});

test("typing in the stock allocation cell drives the slider and the sim, and the cell can be cleared", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = null;

  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;
  mockFn.mockClear();

  const screen = await render(<PlanScreen />);
  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 35, planUntilAge: 65 });

  const alloc = screen.getByRole("textbox", { name: "Stock allocation" });
  await alloc.fill("80");

  // The slider tracks the typed value, and the 80% mix reaches the simulation as
  // the dataset-derived mu/sigma (not a stale default).
  const slider = screen.getByRole("slider", { name: "Stock allocation percent" });
  await expect.element(slider).toHaveAttribute("aria-valuetext", "80% stocks, 20% bonds");
  const expected = deriveAllocationParams(0.8);
  await vi.waitFor(
    () => {
      const calls = mockFn.mock.calls as Array<[{ stockWeight: number; muBps: number }]>;
      const hit = calls.find((c) => c[0]?.stockWeight === 0.8);
      if (hit === undefined) throw new Error("no simulate call for the 80% mix yet");
      expect(hit[0].muBps).toBe(expected.muBps);
    },
    { timeout: 5_000 },
  );

  // The cell can be cleared mid-edit; it must not snap back to the derived value.
  await alloc.fill("");
  expect((alloc.element() as HTMLInputElement).value).toBe("");
});

test("a saved plan loads without ever flashing the intro empty-state", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "500000")] };
  h.planRecord = {
    status: "success",
    data: {
      id: "plan-singleton",
      payload: {
        schemaVersion: 1 as const,
        currentAge: 35,
        planUntilAge: 65,
        monthlyContributionCents: "100000",
        annualSpendCents: "4000000",
        swrBps: 400,
        preset: "balanced" as const,
        seed: "abc123",
      },
    },
  };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  const intro = "Project your path to financial independence";

  // From the first render a saved plan shows the headline skeleton, never the intro.
  expect(screen.container.textContent ?? "").not.toContain(intro);

  await vi.waitFor(
    () => {
      if (screen.container.querySelector("[data-testid='fire-age-value']") === null) {
        throw new Error("headline not rendered yet");
      }
    },
    { timeout: 5_000 },
  );

  // Still no intro after the result resolves.
  expect(screen.container.textContent ?? "").not.toContain(intro);
});

test("the first projection runs immediately on load, not after the 300ms debounce", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = null;

  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;
  mockFn.mockClear();

  const screen = await render(<PlanScreen />);
  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 35, planUntilAge: 65 });

  // The first run bypasses the 300ms debounce, so simulate fires well under it.
  // If the debounce were reintroduced on first load, this would time out at 250ms.
  await vi.waitFor(() => expect(mockFn).toHaveBeenCalled(), { timeout: 250 });
});

test("AE11: monthly contribution field carries the manual-estimate label", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };

  const screen = await render(<PlanScreen />);

  // The Input component uses a label element; getByRole textbox with accessible name works.
  await expect
    .element(screen.getByRole("textbox", { name: /monthly contribution/i }))
    .toBeVisible();
});

// ---------------------------------------------------------------------------
// Number-field editing: a controlled type=number clobbers mid-entry (can't
// delete to empty, decimals reset). The fields edit as text, so a user can
// backspace to empty and type a decimal character-by-character without loss.
// ---------------------------------------------------------------------------

test("number fields edit freely: backspace to empty and type a decimal", async () => {
  const { userEvent } = await import("@vitest/browser/context");
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };

  const screen = await render(<PlanScreen />);
  const swr = screen.getByRole("textbox", { name: "Withdrawal rate" });
  await expect.element(swr).toHaveValue("4");

  // Backspace from the end clears the field entirely (the reported pain point).
  const el = swr.element() as HTMLInputElement;
  await userEvent.click(swr);
  await userEvent.keyboard("{End}{Backspace}");
  expect(el.value).toBe("");

  // A decimal types in character-by-character without the "3." resetting.
  await userEvent.keyboard("3.5");
  expect(el.value).toBe("3.5");
});

// ---------------------------------------------------------------------------
// AE12: Outputs labeled as inflation-adjusted / today's dollars
// ---------------------------------------------------------------------------

test("AE12: results are labeled as today's dollars", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await fillMinimumInputs(screen);

  await vi.waitFor(
    () => {
      const text = screen.container.textContent ?? "";
      if (!text.toLowerCase().includes("today")) throw new Error("label not visible yet");
    },
    { timeout: 5_000 },
  );

  expect(screen.container.textContent?.toLowerCase()).toContain("today");
});

// ---------------------------------------------------------------------------
// Validation: age 15 rejected inline
// ---------------------------------------------------------------------------

test("validation: age 15 is rejected with an inline error", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };

  const screen = await render(<PlanScreen />);

  const ageInput = screen.getByRole("textbox", { name: "Current age" });
  await ageInput.fill("15");
  // Validation fires on blur (mode: "onBlur"); a real blur emits the focusout
  // that React's onBlur delegation listens for.
  (ageInput.element() as HTMLInputElement).blur();

  await vi.waitFor(
    () => {
      const text = screen.container.textContent ?? "";
      if (!text.includes("16") && !text.includes("Age must be")) throw new Error("no error yet");
    },
    { timeout: 3_000 },
  );

  const text = screen.container.textContent ?? "";
  expect(text.includes("16") || text.includes("Age must be")).toBe(true);
});

// ---------------------------------------------------------------------------
// Validation: SWR 8% accepted (non-blocking warning, no rejection error)
// ---------------------------------------------------------------------------

test("validation: SWR 8% accepted (warning shown but not a hard error)", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };

  const screen = await render(<PlanScreen />);

  await fillMinimumInputs(screen, { swr: 8, spend: 40000, age: 35, planUntilAge: 65 });

  // The non-blocking "aggressive" guidance appears (8% is above the 6% band)...
  await vi.waitFor(
    () => {
      const text = screen.container.textContent ?? "";
      if (!text.includes("aggressive")) throw new Error("warning not shown yet");
    },
    { timeout: 2_000 },
  );
  expect(screen.container.textContent).toContain("SWR above 6% is aggressive");

  // ...but the hard rejection error for 8% must NOT appear (max is 10%).
  expect(screen.container.textContent).not.toContain("SWR must be at most");
});

// ---------------------------------------------------------------------------
// Currency disclosure: mixed-currency accounts show exclusion notice
// ---------------------------------------------------------------------------

test("currency disclosure renders for mixed-currency accounts", async () => {
  h.accounts = {
    status: "success",
    data: [
      makeCashAccount("c1", "USD Checking", "100000", "USD"),
      makeCashAccount("c2", "EUR Savings", "200000", "EUR"),
    ],
  };
  h.planRecord = { status: "none" };

  const screen = await render(<PlanScreen />);

  await expect.element(screen.getByRole("note", { name: /currency exclusion/i })).toBeVisible();

  // EUR is primary (count tie broken by asset value: EUR holds $2,000 vs
  // USD's $1,000), so USD Checking is excluded.
  await expect.element(screen.getByText(/USD Checking/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// In-progress: prior results stay visible while re-computing
// ---------------------------------------------------------------------------

test("in-progress: prior results stay visible while re-computing", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);

  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 35, planUntilAge: 65 });

  // Wait for first result.
  await vi.waitFor(
    () => {
      const el = screen.container.querySelector("[data-testid='fire-age-value']");
      if (el === null) throw new Error("first result not ready");
    },
    { timeout: 5_000 },
  );

  // Introduce delay then trigger a re-compute.
  h.simulateDelay = 300;

  await screen.getByRole("textbox", { name: "Withdrawal rate" }).fill("4.5");

  // While computing, the computing indicator should appear.
  await vi.waitFor(
    () => {
      const indicator = screen.container.querySelector("[aria-label='Recomputing projections']");
      if (indicator === null) throw new Error("computing indicator not shown yet");
    },
    { timeout: 2_000 },
  );

  // Prior fire-age-value still in DOM during recompute.
  expect(screen.container.querySelector("[data-testid='fire-age-value']")).not.toBeNull();

  h.simulateDelay = 0;
});

// ---------------------------------------------------------------------------
// Failure path: a failed run surfaces a retry, and retrying recovers
// ---------------------------------------------------------------------------

test("simulation failure shows a retry affordance and retrying recovers", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = null;

  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;
  mockFn.mockClear();
  // Fail only the first run; the retry falls through to the default mock.
  mockFn.mockImplementationOnce(async () => {
    throw new Error("worker boom");
  });

  const screen = await render(<PlanScreen />);
  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 35, planUntilAge: 65 });

  // The failure surfaces an error with a retry, not an endless skeleton.
  await expect.element(screen.getByRole("alert", { name: /projection error/i })).toBeVisible();
  const retry = screen.getByRole("button", { name: /try again/i });
  await expect.element(retry).toBeVisible();
  expect(screen.container.querySelector("[data-testid='fire-age-value']")).toBeNull();

  // Retrying recovers and renders the result.
  await retry.click();
  await vi.waitFor(
    () => {
      const el = screen.container.querySelector("[data-testid='fire-age-value']");
      if (el === null) throw new Error("results not rendered after retry");
    },
    { timeout: 5_000 },
  );
  expect(screen.container.querySelector("[data-testid='fire-age-value']")).not.toBeNull();
});

// ---------------------------------------------------------------------------
// Generation guard: stale in-flight run does not overwrite newer result
// ---------------------------------------------------------------------------

test("stale in-flight run does not overwrite a newer result", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = null;

  // Set up two controlled promises: first call blocks, second resolves immediately.
  // eslint-disable-next-line prefer-const
  let firstCallResolve: (() => void) | null = null;
  let callCount = 0;

  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;
  mockFn.mockImplementation(async (input: { currentAge: number; planUntilAge: number }) => {
    callCount++;
    if (callCount === 1) {
      // First call: block until manually resolved.
      return new Promise<SimulateResult>((resolve) => {
        firstCallResolve = () => resolve(buildDefaultResult({ currentAge: 35, planUntilAge: 65 }));
      });
    }
    // Second call (different input): resolve immediately with a distinct medianFireAge.
    return {
      ...buildDefaultResult(input),
      mc: { ...buildDefaultResult(input).mc, medianFireAge: 60 },
    };
  });

  const screen = await render(<PlanScreen />);

  // First form fill -- triggers first (stale) simulation.
  await screen.getByRole("textbox", { name: "Current age" }).fill("35");
  await screen.getByRole("textbox", { name: "Plan until age" }).fill("65");
  await screen.getByRole("textbox", { name: "Target annual spend" }).fill("40000");
  await screen.getByRole("textbox", { name: "Withdrawal rate" }).fill("4");

  // Let the debounce fire.
  await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(1), { timeout: 1_000 });

  // Change an input to trigger the second (newer) simulation.
  await screen.getByRole("textbox", { name: "Withdrawal rate" }).fill("3");

  // Wait for second call to complete and render.
  await vi.waitFor(
    () => {
      const el = screen.container.querySelector("[data-testid='fire-age-value']");
      if (el === null) throw new Error("fire-age-value not yet rendered");
      return el;
    },
    { timeout: 5_000 },
  );

  // Now resolve the stale first call.
  (firstCallResolve as (() => void) | null)?.call(null);

  // Give React a tick to process any spurious state update.
  await new Promise((r) => setTimeout(r, 50));

  // The rendered FIRE age should still reflect the NEWER run (medianFireAge 60),
  // not the stale first run's result (medianFireAge 52).
  const fireAgeEl = screen.container.querySelector("[data-testid='fire-age-value']");
  expect(fireAgeEl?.textContent).toBe("60");

  // Restore the original mock.
  mockFn.mockImplementation(async (input: { currentAge: number; planUntilAge: number }) => {
    if (h.simulateDelay > 0) await new Promise((r) => setTimeout(r, h.simulateDelay));
    if (h.simulateResult !== null) return h.simulateResult;
    return buildDefaultResult(input);
  });
});

// ---------------------------------------------------------------------------
// Form filled before potResult arrives: sim runs once pot resolves
// ---------------------------------------------------------------------------

test("form filled while pot loading still runs simulation when pot resolves", async () => {
  // potResult is held null by the missing-price guard: a priced holding with no
  // price entry. The form is still visible (accounts are loaded), so the user
  // can type before the pot exists.
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = {
    ...buildDefaultResult({ currentAge: 40, planUntilAge: 75 }),
    mc: { ...buildDefaultResult({ currentAge: 40, planUntilAge: 75 }).mc, medianFireAge: 58 },
  };
  h.holdings = [
    {
      id: "h1",
      accountId: "c1",
      groupId: null,
      ticker: "VTI",
      assetType: "etf",
      proxyTicker: null,
      name: "Total Market",
      sharesMajor: "10",
      sharesScale: 0,
      costBasisCents: "100000",
      scaleFactor: "1",
      updatedAt: Date.now(),
    },
  ];
  h.prices = new Map();

  const screen = await render(<PlanScreen />);

  await screen.getByRole("textbox", { name: "Current age" }).fill("40");
  await screen.getByRole("textbox", { name: "Plan until age" }).fill("75");
  await screen.getByRole("textbox", { name: "Target annual spend" }).fill("50000");
  await screen.getByRole("textbox", { name: "Withdrawal rate" }).fill("4");

  // Past the 300ms debounce: no simulation may run while the price is missing.
  await new Promise((r) => setTimeout(r, 500));
  expect(screen.container.querySelector("[data-testid='fire-age-value']")).toBeNull();

  // Price arrives; the pot becomes derivable. No further form edits.
  h.prices = new Map([["VTI", toCents(100)]]);
  await screen.rerender(<PlanScreen />);

  await vi.waitFor(
    () => {
      const el = screen.container.querySelector("[data-testid='fire-age-value']");
      if (el === null) throw new Error("no result yet");
      return el;
    },
    { timeout: 5_000 },
  );

  expect(screen.container.querySelector("[data-testid='fire-age-value']")?.textContent).toBe("58");

  h.holdings = [];
  h.prices = new Map();
});

// ---------------------------------------------------------------------------
// Never-FI state: headline shows "FIRE not on this path"
// ---------------------------------------------------------------------------

test("neverFiFraction > 0.5 and medianFireAge === planUntilAge shows the never-FI headline", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  const planUntil = 95;
  h.simulateResult = {
    fireNumber: toCents(2_000_000),
    mc: {
      successRate: 0.12,
      neverFiFraction: 0.8,
      medianFireAge: planUntil, // engine sets fireAge = planUntilAge for never-FI paths
      pathCount: 100,
      yearlyBands: [makeBand(50_000, 60_000, 70_000, 80_000, 90_000)],
    },
    replay: {
      survivalShare: 0.15,
      excludedWindowCount: 0,
      completeWindowCount: 90,
      worstCohorts: [],
    },
  };

  const screen = await render(<PlanScreen />);
  await fillMinimumInputs(screen, { spend: 80000, swr: 4, age: 35, planUntilAge: planUntil });

  await vi.waitFor(
    () => {
      const text = screen.container.textContent ?? "";
      if (!text.includes("FIRE not on this path"))
        throw new Error("never-FI headline not visible yet");
    },
    { timeout: 5_000 },
  );

  // Headline + anchor (today vs target progress) render for the never-FI state
  expect(screen.container.textContent).toContain("FIRE not on this path");
  expect(screen.container.textContent).toContain("of the way to your number");
});

// ---------------------------------------------------------------------------
// Corrupt record: notice shown and Save disabled
// ---------------------------------------------------------------------------

test("corrupt plan record shows notice and disables Save", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "error", error: new Error("Schema parse failed") };

  const screen = await render(<PlanScreen />);

  await expect.element(screen.getByRole("note", { name: /plan load error/i })).toBeVisible();
  await expect.element(screen.getByText(/could not be loaded/i)).toBeVisible();

  // Save button must be present but disabled.
  const saveBtn = screen.getByRole("button", { name: /save plan/i });
  await expect.element(saveBtn).toBeVisible();
  expect((saveBtn.element() as HTMLButtonElement).disabled).toBe(true);

  // Form inputs must still be editable.
  await expect.element(screen.getByRole("textbox", { name: "Current age" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Save: mutation payload has correct shape
// ---------------------------------------------------------------------------

test("save: Save plan button invokes savePlan with valid payload structure", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "500000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = null;
  h.savePlanMock.mockClear();

  const screen = await render(<PlanScreen />);

  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 35, planUntilAge: 65 });

  await vi.waitFor(
    () => {
      const el = screen.container.querySelector("[data-testid='fire-age-value']");
      if (el === null) throw new Error("result not ready");
    },
    { timeout: 5_000 },
  );

  await screen.getByRole("button", { name: /save plan/i }).click();

  await vi.waitFor(() => expect(h.savePlanMock).toHaveBeenCalledTimes(1), { timeout: 3_000 });

  const payload = h.savePlanMock.mock.calls[0]![0] as Record<string, unknown>;
  expect(payload).toHaveProperty("schemaVersion", 1);
  expect(payload).toHaveProperty("currentAge", 35);
  expect(payload).toHaveProperty("planUntilAge", 65);
  expect(payload).toHaveProperty("swrBps", 400);
  // Dollars convert to exact minor units (no float drift): $40,000 -> 4,000,000 cents.
  expect(payload).toHaveProperty("annualSpendCents", "4000000");
  expect(payload).toHaveProperty("seed");
  expect(typeof payload.seed).toBe("string");
  expect(payload.seed).toBeTruthy();
});

// ---------------------------------------------------------------------------
// P1-2/P1-3: headline copy + method-card values (normal projection path)
// ---------------------------------------------------------------------------

test("normal projection path: headline contains 'FIRE at' and confidence rates match fixture", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null; // uses buildDefaultResult (successRate 0.87, survivalShare 0.91)

  const screen = await render(<PlanScreen />);
  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 35, planUntilAge: 65 });

  await vi.waitFor(
    () => {
      const el = screen.container.querySelector("[data-testid='fire-age-value']");
      if (el === null) throw new Error("fire-age-value not yet rendered");
    },
    { timeout: 5_000 },
  );

  // P1-2a: headline copy
  expect(screen.container.textContent).toContain("FIRE at");

  // P1-2b/P1-3: confidence rates match fixture (0.87 -> "87%", 0.91 -> "91%")
  const mcRate = screen.getByTestId("mc-success-rate");
  await expect.element(mcRate).toBeVisible();
  expect(mcRate.element().textContent).toContain("87%");

  const replayRate = screen.getByTestId("replay-success-rate");
  await expect.element(replayRate).toBeVisible();
  expect(replayRate.element().textContent).toContain("91%");

  // P1-3: the Historical replay tooltip explains the method (matches the mock copy).
  await screen.getByRole("button", { name: "What is Historical Replay?" }).hover();
  const tip = screen.getByRole("tooltip").first();
  await expect.element(tip).toBeVisible();
  expect(tip.element().textContent ?? "").toContain(
    "every real stretch of market history since 1871",
  );
});

// ---------------------------------------------------------------------------
// Milestones + levers: the FIRE ladder and the what-if readout (normal path)
// ---------------------------------------------------------------------------

test("milestones show the FIRE ladder and the lever readout matches the headline at rest", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "100000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null; // buildDefaultResult: fireNumber $1M, medianFireAge 52

  const screen = await render(<PlanScreen />);
  await fillMinimumInputs(screen, { spend: 40000, swr: 4, age: 35, planUntilAge: 65 });

  await vi.waitFor(
    () => {
      const el = screen.container.querySelector("[data-testid='fire-age-value']");
      if (el === null) throw new Error("fire-age-value not yet rendered");
    },
    { timeout: 5_000 },
  );

  // Milestones section: amounts are exact functions of the $1,000,000 number.
  const milestones = screen.getByRole("region", { name: "Your FIRE milestones" });
  await expect.element(milestones).toBeVisible();
  const mText = milestones.element().textContent ?? "";
  expect(mText).toContain("Coast FIRE");
  expect(mText).toContain("$700k"); // Lean = 0.7 x 1,000,000
  expect(mText).toContain("$1M"); // FIRE = the number
  expect(mText).toContain("$1.5M"); // Fat = 1.5 x 1,000,000
  // FIRE milestone is reached at the MC median age 52.
  expect(mText).toContain("at age 52");

  // Levers hide while the editor is open (they edit the same plan); close it.
  await screen.getByRole("button", { name: "Done editing assumptions" }).click();

  // Levers section: at rest, the readout equals the headline FIRE age.
  const levers = screen.getByRole("region", { name: "What moves your FIRE age" });
  await expect.element(levers).toBeVisible();
  const leverAge = screen.getByTestId("lever-fire-age");
  await expect.element(leverAge).toBeVisible();
  expect(leverAge.element().textContent?.trim()).toBe("52");

  // The four lever sliders are present and operable.
  await expect
    .element(screen.getByRole("slider", { name: "Allocation (percent stocks)" }))
    .toBeVisible();
});

// ---------------------------------------------------------------------------
// P1-1 regression: returning user's collapsed bar shows saved values, not placeholder
// ---------------------------------------------------------------------------

test("returning user: collapsed bar shows saved plan values and not the placeholder", async () => {
  const savedPayload = {
    schemaVersion: 1 as const,
    currentAge: 35,
    planUntilAge: 65,
    monthlyContributionCents: "100000", // $1,000/mo
    annualSpendCents: "4000000", // $40,000/yr
    swrBps: 400,
    preset: "balanced" as const,
    seed: "abc123",
  };

  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "500000")] }; // $5,000
  h.planRecord = {
    status: "success",
    data: { id: "plan-singleton", payload: savedPayload },
  };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);

  // Wait for the initial auto-run to complete (saved plan triggers simulation)
  await vi.waitFor(
    () => {
      const el = screen.container.querySelector("[data-testid='fire-age-value']");
      if (el === null) throw new Error("fire-age-value not yet rendered");
    },
    { timeout: 5_000 },
  );

  // Bar starts collapsed for a returning user: Adjust button is visible
  const adjustBtn = screen.getByRole("button", { name: "Adjust plan" });
  await expect.element(adjustBtn).toBeVisible();

  // "Current age" input is NOT visible (form is unmounted in collapsed state)
  expect(
    screen.container.querySelector("input[id*='currentAge'], [aria-label='Current age']"),
  ).toBeNull();

  // Collapsed summary chips must show the saved values, NOT the placeholder
  const text = screen.container.textContent ?? "";
  expect(text).not.toContain("Set your assumptions to project.");
  // $1,000/mo contribution
  expect(text).toContain("$1,000");
  // $40,000/yr spend
  expect(text).toContain("$40,000");
  // age range from the saved plan
  expect(text).toContain("35 to 65");

  // Expand: click Adjust, form inputs appear
  await adjustBtn.click();
  await vi.waitFor(
    () => {
      const input = screen.container.querySelector("[aria-label='Current age'], input");
      if (input === null) throw new Error("form not expanded yet");
    },
    { timeout: 3_000 },
  );
  // The Done button should now be visible (expanded state)
  const doneBtn = screen.getByRole("button", { name: "Done editing assumptions" });
  await expect.element(doneBtn).toBeVisible();

  // Collapse again: click Done
  await doneBtn.click();
  await vi.waitFor(
    () => {
      const adjust2 = screen.container.querySelector("[aria-label='Adjust plan']");
      if (adjust2 === null) throw new Error("bar did not collapse");
    },
    { timeout: 3_000 },
  );

  // After re-collapse, still shows the saved values not the placeholder
  const textAfter = screen.container.textContent ?? "";
  expect(textAfter).not.toContain("Set your assumptions to project.");
  expect(textAfter).toContain("$40,000");
});

// ---------------------------------------------------------------------------
// LeverReadout: the sooner / later / off-track branches against the baseline
// ---------------------------------------------------------------------------

const leverValues: PlanFormValues = {
  currentAge: 35,
  planUntilAge: 65,
  monthlyContribution: 1000,
  annualSpend: 40000,
  swrPercent: 4,
  preset: "balanced",
};

test("lever readout shows 'sooner' when the current FIRE age beats the saved baseline", async () => {
  const screen = await render(
    <LeversSection
      values={leverValues}
      baseline={leverValues}
      currentFireAge={52}
      currentNeverFi={false}
      baselineFireAge={55}
      baselineNeverFi={false}
      onChange={() => {}}
    />,
  );
  const readout = screen.getByRole("region", { name: "What moves your FIRE age" });
  expect(readout.element().textContent ?? "").toContain("3 yrs sooner");
  expect(screen.getByTestId("lever-fire-age").element().textContent?.trim()).toBe("52");
});

test("lever readout shows 'later' when the current FIRE age trails the saved baseline", async () => {
  const screen = await render(
    <LeversSection
      values={leverValues}
      baseline={leverValues}
      currentFireAge={57}
      currentNeverFi={false}
      baselineFireAge={55}
      baselineNeverFi={false}
      onChange={() => {}}
    />,
  );
  const readout = screen.getByRole("region", { name: "What moves your FIRE age" });
  expect(readout.element().textContent ?? "").toContain("2 yrs later");
});

test("lever readout shows 'Off track' when the current setting never reaches FIRE", async () => {
  const screen = await render(
    <LeversSection
      values={leverValues}
      baseline={leverValues}
      currentFireAge={65}
      currentNeverFi={true}
      baselineFireAge={55}
      baselineNeverFi={false}
      onChange={() => {}}
    />,
  );
  const readout = screen.getByRole("region", { name: "What moves your FIRE age" });
  expect(readout.element().textContent ?? "").toContain("Off track at this setting");
});
