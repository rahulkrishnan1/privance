import type { Account, AccountId, UserId } from "@privance/core";
import { asId, asIsoDateTime, Decimal, SCALE_CENTS } from "@privance/core";
import type { SimulateResult, YearBand } from "@privance/core/projection";
import { deriveAllocationParams } from "@privance/core/projection";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
// Load the real stylesheet so a `veil-on` ancestor actually blurs `.vfig`
// figures and getComputedStyle reports it, not just a class marker.
import "@/globals.css";

const h = vi.hoisted(() => ({
  accounts: { status: "success", data: [] as unknown[] },
  planRecord: { status: "none" } as {
    status: "none" | "initialising" | "success" | "error";
    data?: unknown;
    error?: Error;
  },
  holdings: [] as unknown[],
  prices: new Map<string, Decimal>(),
  pricesLoading: false,
  simulateResult: null as SimulateResult | null,
  simulateDelay: 0,
  savePlanMock: vi.fn(async (_payload: unknown) => {}),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

vi.mock("./queries", () => ({
  usePlanRecord: () => h.planRecord,
}));

vi.mock("./mutations", () => ({
  useSavePlan: () => ({ savePlan: h.savePlanMock, state: "idle", error: null }),
}));

vi.mock("@/features/accounts/queries", async () => {
  const { centsToDecimal, getBalanceCents } = await import("@/features/accounts/balance");
  return { useAccountsQuery: () => h.accounts, centsToDecimal, getBalanceCents };
});

vi.mock("@/features/holdings/queries", () => ({
  useHoldingsQuery: () => ({ holdings: h.holdings, loading: false, error: null, reload: vi.fn() }),
}));

vi.mock("@/lib/queries/prices", () => ({
  usePricesQuery: () => ({
    prices: h.prices,
    previousPrices: new Map(),
    isLoading: h.pricesLoading,
  }),
}));

vi.mock("@/lib/sim/worker-client", () => ({
  simulate: vi.fn(async (input: unknown) => {
    if (h.simulateDelay > 0) await new Promise((r) => setTimeout(r, h.simulateDelay));
    if (h.simulateResult !== null) return h.simulateResult;
    return buildDefaultResult(input as { currentAge: number; planUntilAge: number });
  }),
}));

import { PlanScreen } from "./plan-screen";

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

function makeInvestmentAccount(id: string, name: string, cashBalanceCents: string): Account {
  return {
    id: asId<AccountId>(id),
    userId: asId<UserId>("u1"),
    createdAt: NOW,
    lastUpdatedAt: NOW,
    payload: {
      kind: "investment",
      subKind: "brokerage",
      name,
      cashBalanceCents,
      currency: "USD",
      assetType: "stock",
    },
  } as Account;
}

/** A holding whose ticker the price feed never resolves (delisted/unknown). */
function makeUnpricedHolding(accountId: string, ticker: string): unknown {
  return {
    id: `h-${ticker}`,
    accountId,
    groupId: null,
    ticker,
    name: ticker,
    assetType: "stock",
    proxyTicker: null,
    sharesMajor: "10",
    sharesScale: 0,
    costBasisCents: "100000",
    scaleFactor: undefined,
    updatedAt: Date.parse("2024-01-01T00:00:00.000Z"),
  };
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

function setRange(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function waitForHeadline(screen: Awaited<ReturnType<typeof render>>) {
  await vi.waitFor(
    () => {
      if (screen.container.querySelector("[data-testid='fire-age-value']") === null) {
        throw new Error("headline not rendered yet");
      }
    },
    { timeout: 5_000 },
  );
}

test("accounts present and no plan auto-seeds the panel and renders the headline sentence", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "50000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  expect(screen.container.textContent).toContain("Independent by");
  expect(screen.container.querySelector("[data-testid='fire-age-value']")?.textContent).toBe("52");
  // The progress anchor shows the account-derived pot as "Today".
  expect(screen.container.textContent).toContain("$500,000");
});

test("a holding whose price never resolves does not wedge the projection on a skeleton", async () => {
  // Regression: the pot derivation used to null out (and the screen stay on the
  // "Loading projection" skeleton forever) if ANY holding lacked a price. A
  // delisted or unknown ticker never resolves, so once prices settle the pot
  // must compute from what valued and leave the unpriced holding out.
  h.accounts = {
    status: "success",
    data: [
      makeCashAccount("c1", "Checking", "50000000"),
      makeInvestmentAccount("i1", "Brokerage", "0"),
    ],
  };
  h.holdings = [makeUnpricedHolding("i1", "ZZUNKNOWN")];
  h.prices = new Map(); // ZZUNKNOWN intentionally absent
  h.pricesLoading = false; // fetch settled; the ticker simply never resolved
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  expect(screen.container.textContent).toContain("Independent by");
  expect(screen.container.textContent).not.toContain("Loading projection");

  h.holdings = [];
  h.prices = new Map();
});

test("does not seed account defaults while the saved plan is still loading", async () => {
  // Race: accounts (the pot) settle before the encrypted plan finishes
  // decrypting. If we seed ACCOUNT_DEFAULTS during "initialising", the saved
  // plan can never load afterwards. While it loads we show neither the seeded
  // headline nor the no-accounts empty state.
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "50000000")] };
  h.planRecord = { status: "initialising" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await new Promise((r) => setTimeout(r, 50));

  expect(screen.container.querySelector("[data-testid='fire-age-value']")).toBeNull();
  expect(screen.container.textContent).not.toContain("Project your path to independence.");
});

test("the headline veils money only, not the FI age or year", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "50000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  // Render under a veil-on ancestor so the actual obscuring is observable.
  const screen = await render(
    <div className="veil-on">
      <PlanScreen />
    </div>,
  );
  await waitForHeadline(screen);

  const blurOf = (el: Element | null | undefined) => (el ? getComputedStyle(el).filter : "missing");

  // The FI year and age are not money, so they stay sharp even while veiled.
  const year = screen.container.querySelector("[data-testid='fire-year']");
  const age = screen.container.querySelector("[data-testid='fire-age-value']");
  expect(blurOf(year)).toBe("none");
  expect(blurOf(age)).toBe("none");

  // The spending figure in the same sentence is money, so it is actually blurred.
  const moneyFigure = screen.container.querySelector("h1 .vfig");
  expect(moneyFigure).not.toBeNull();
  expect(blurOf(moneyFigure)).toContain("blur");
});

test("no accounts shows the empty state with an Add accounts CTA and no manual shortcut", async () => {
  h.accounts = { status: "success", data: [] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);

  await expect.element(screen.getByRole("button", { name: "Add accounts" })).toBeVisible();
  expect(screen.container.textContent).toContain("Project your path to independence.");
  await expect
    .element(screen.getByRole("button", { name: /enter an amount/i }))
    .not.toBeInTheDocument();
});

test("the Monte Carlo / Historical toggle switches the confidence figure", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  expect(screen.getByTestId("confidence-rate").element().textContent).toContain("87%");

  await screen.getByRole("radio", { name: "Historical replay" }).click();
  await expect.element(screen.getByTestId("confidence-rate")).toHaveTextContent("91%");
  expect(screen.container.textContent).toContain("of real markets since 1871 survived");
});

test("pot >= FIRE number shows the financially-independent-today headline", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Brokerage", "150000000")] };
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
  await vi.waitFor(
    () => {
      if (!(screen.container.textContent ?? "").toLowerCase().includes("financially independent")) {
        throw new Error("FI headline not visible yet");
      }
    },
    { timeout: 5_000 },
  );
  expect(screen.container.textContent?.toLowerCase()).toContain("today");
  expect(screen.container.querySelector("[data-testid='fire-age-value']")).toBeNull();
});

test("never-FI result shows the off-path headline, not a misleading confidence figure", async () => {
  const planUntil = 95;
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = {
    fireNumber: toCents(2_000_000),
    mc: {
      successRate: 0.12,
      neverFiFraction: 0.8,
      medianFireAge: planUntil,
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
  await vi.waitFor(
    () => {
      if (!(screen.container.textContent ?? "").includes("isn't on this path")) {
        throw new Error("never-FI headline not visible yet");
      }
    },
    { timeout: 5_000 },
  );
  expect(screen.container.querySelector("[data-testid='confidence-rate']")).toBeNull();
});

test("moving the stock allocation slider feeds derived mu/sigma into the simulation", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;
  mockFn.mockClear();

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  const slider = screen.getByRole("slider", { name: "Stock allocation (percent stocks)" });
  setRange(slider.element() as HTMLInputElement, "80");
  await expect.element(slider).toHaveAttribute("aria-valuetext", "80% stocks, 20% bonds");

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

test("editing flips Save to active, and saving sends a v2 payload", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "50000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;
  h.savePlanMock.mockClear();

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  // Auto-seeded plan is dirty (no saved baseline yet): Save is active.
  const save = screen.getByRole("button", { name: "Save plan" });
  await expect.element(save).toBeVisible();
  expect((save.element() as HTMLButtonElement).disabled).toBe(false);

  await save.click();
  await vi.waitFor(() => expect(h.savePlanMock).toHaveBeenCalledTimes(1), { timeout: 3_000 });

  const payload = h.savePlanMock.mock.calls[0]?.[0] as Record<string, unknown>;
  expect(payload).toHaveProperty("schemaVersion", 2);
  expect(payload).toHaveProperty("currentAge", 35);
  expect(payload).toHaveProperty("annualSpendCents", "4000000");
  expect(payload).toHaveProperty("seed");
});

test("a manual starting amount is saved as manualStartingPotCents", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;
  h.savePlanMock.mockClear();

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  await screen.getByRole("radio", { name: "Manual" }).click();
  await screen.getByRole("textbox", { name: "Starting portfolio" }).fill("500000");
  await screen.getByRole("button", { name: "Save plan" }).click();

  await vi.waitFor(() => expect(h.savePlanMock).toHaveBeenCalled(), { timeout: 3_000 });
  const payload = h.savePlanMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  expect(payload).toHaveProperty("schemaVersion", 2);
  expect(payload).toHaveProperty("manualStartingPotCents", "50000000");
});

test("a saved plan loads its values into the panel and is not flagged dirty", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = {
    status: "success",
    data: {
      payload: {
        schemaVersion: 2,
        currentAge: 42,
        planUntilAge: 95,
        monthlyContributionCents: "200000",
        annualSpendCents: "5000000",
        swrBps: 350,
        seed: "a1b2c3d4",
        preset: "aggressive",
      },
    },
  };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  await expect.element(screen.getByRole("textbox", { name: "Current age" })).toHaveValue("42");
  // Unedited saved plan is not dirty: the button reads as already saved.
  await expect.element(screen.getByRole("button", { name: "Plan saved" })).toBeVisible();
});

test("a manual starting amount settles instead of re-simulating forever", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);
  await screen.getByRole("radio", { name: "Manual" }).click();
  await screen.getByRole("textbox", { name: "Starting portfolio" }).fill("500000");
  await waitForHeadline(screen);

  // Let the debounced run for the typed amount settle, then snapshot the count.
  await new Promise((r) => setTimeout(r, 350));
  const settled = mockFn.mock.calls.length;
  // An un-memoised pot rescheduled a sim every ~300ms; with the fix, an idle
  // manual plan fires no further runs.
  await new Promise((r) => setTimeout(r, 700));
  expect(mockFn.mock.calls.length).toBe(settled);
});

test("milestones show the Coast / Lean / FI / Fat ladder with amounts", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  const text = screen.container.textContent ?? "";
  expect(text).toContain("Coast FI");
  expect(text).toContain("Lean FI");
  expect(text).toContain("Fat FI");
  expect(text).toContain("$1M"); // FI = the number
});

test("the projection carries the method note", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);
  expect(screen.container.textContent).toContain("1,000 simulated futures");
});

test("currency disclosure renders for mixed-currency accounts", async () => {
  h.accounts = {
    status: "success",
    data: [
      makeCashAccount("c1", "USD Checking", "100000", "USD"),
      makeCashAccount("c2", "EUR Savings", "200000", "EUR"),
    ],
  };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await expect.element(screen.getByRole("note", { name: /currency exclusion/i })).toBeVisible();
  await expect.element(screen.getByText(/USD Checking/)).toBeVisible();
});

test("corrupt plan record shows a notice and disables Save", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "error", error: new Error("Schema parse failed") };
  h.simulateResult = null;

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  await expect.element(screen.getByRole("note", { name: /plan load error/i })).toBeVisible();
  const save = screen.getByRole("button", { name: /plan/i }).first();
  expect((save.element() as HTMLButtonElement).disabled).toBe(true);
});

test("a failed projection shows a retry that recovers", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateDelay = 0;
  h.simulateResult = null;

  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;
  mockFn.mockClear();
  mockFn.mockImplementationOnce(async () => {
    throw new Error("worker boom");
  });

  const screen = await render(<PlanScreen />);
  await expect.element(screen.getByRole("alert", { name: /projection error/i })).toBeVisible();
  await screen.getByRole("button", { name: /try again/i }).click();
  await waitForHeadline(screen);
});

test("a stale in-flight run does not overwrite a newer result", async () => {
  h.accounts = { status: "success", data: [makeCashAccount("c1", "Checking", "10000000")] };
  h.planRecord = { status: "none" };
  h.simulateResult = null;

  // Discriminate by input, not call count: background impact sims (paths 200)
  // resolve immediately; the SWR=5% main run blocks (stale), the SWR=6% main run
  // resolves newer (age 60). Tests the genRef guard end-to-end.
  let staleResolve: (() => void) | null = null;
  const { simulate: simulateMock } = await import("@/lib/sim/worker-client");
  const mockFn = simulateMock as ReturnType<typeof vi.fn>;
  mockFn.mockImplementation(
    async (input: { swrBps: number; paths?: number; currentAge: number; planUntilAge: number }) => {
      if (input.paths === 200) return buildDefaultResult(input);
      if (input.swrBps === 500) {
        return new Promise<SimulateResult>((resolve) => {
          staleResolve = () => resolve(buildDefaultResult(input));
        });
      }
      if (input.swrBps === 600) {
        return {
          ...buildDefaultResult(input),
          mc: { ...buildDefaultResult(input).mc, medianFireAge: 60 },
        };
      }
      return buildDefaultResult(input);
    },
  );

  const screen = await render(<PlanScreen />);
  await waitForHeadline(screen);

  const swr = screen.getByRole("slider", { name: "Withdrawal rate" });
  // Start the stale 5% run and wait until it is actually in flight.
  setRange(swr.element() as HTMLInputElement, "5");
  await vi.waitFor(() => expect(staleResolve).not.toBeNull(), { timeout: 3_000 });

  // Start the newer 6% run; it resolves to age 60.
  setRange(swr.element() as HTMLInputElement, "6");
  await vi.waitFor(
    () => {
      if (screen.container.querySelector("[data-testid='fire-age-value']")?.textContent !== "60") {
        throw new Error("newer result not rendered yet");
      }
    },
    { timeout: 5_000 },
  );

  // Resolving the stale run must not clobber the newer result.
  (staleResolve as (() => void) | null)?.call(null);
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.container.querySelector("[data-testid='fire-age-value']")?.textContent).toBe("60");

  mockFn.mockImplementation(async (input: { currentAge: number; planUntilAge: number }) => {
    if (h.simulateResult !== null) return h.simulateResult;
    return buildDefaultResult(input);
  });
});
