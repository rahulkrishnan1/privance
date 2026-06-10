"use client";

import type { Holding, HoldingGroupId, HoldingId, PlanPayload } from "@privance/core";
import { asId, asIsoDateTime, Decimal, SCALE_CENTS } from "@privance/core";
import type { SimulateResult } from "@privance/core/projection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Screen } from "@/components/index";
import { useAccountsQuery } from "@/features/accounts/queries";
import { useHoldingsQuery } from "@/features/holdings/queries";
import { usePricesQuery } from "@/lib/queries/prices";
import type { SimWorkerInput } from "@/lib/sim/worker-client";
import { simulate } from "@/lib/sim/worker-client";
import { AssumptionsBar } from "./components/assumptions-bar";
import { PlanHeadline } from "./components/plan-headline";
import { ResultsPanel } from "./components/results-panel";
import { FanChartSkeleton, ResultsSkeleton } from "./components/skeletons";
import { useSavePlan } from "./mutations";
import { deriveLiquidPot } from "./pot";
import { usePlanRecord } from "./queries";
import { payloadToSimInput } from "./sim-input";
import { isNeverFiState, type PlanFormValues, samePlanValues } from "./types";

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function generateSeed(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Form <-> sim/payload conversions
// ---------------------------------------------------------------------------

// Form -> payload -> sim input, so preset resolution and the custom-override
// defaults live in exactly one place (payloadToSimInput) instead of being
// duplicated with magic fallback literals here.
function formToSimInput(values: PlanFormValues, potCents: Decimal, seed: string): SimWorkerInput {
  return payloadToSimInput(formToPayload(values, seed), potCents);
}

function formToPayload(values: PlanFormValues, seed: string): PlanPayload {
  const base = {
    schemaVersion: 1 as const,
    currentAge: values.currentAge,
    planUntilAge: values.planUntilAge,
    // Dollars -> cents through Decimal (no float arithmetic on the amount): the
    // form value is rounded to cents at the display boundary, then parsed exactly.
    monthlyContributionCents: Decimal.fromString((values.monthlyContribution ?? 0).toFixed(2))
      .toMinorUnits()
      .toString(),
    annualSpendCents: Decimal.fromString(values.annualSpend.toFixed(2)).toMinorUnits().toString(),
    swrBps: Math.round(values.swrPercent * 100),
    seed,
  };

  if (values.preset === "custom") {
    return {
      ...base,
      preset: "custom" as const,
      muBps: Math.round((values.muPercent ?? 5.91) * 100),
      sigmaBps: Math.round((values.sigmaPercent ?? 11.67) * 100),
      stockWeightBps: Math.round((values.stockWeightPercent ?? 60) * 100),
    };
  }

  return { ...base, preset: values.preset };
}

function planToFormValues(plan: PlanPayload): PlanFormValues {
  const base: PlanFormValues = {
    currentAge: plan.currentAge,
    planUntilAge: plan.planUntilAge,
    monthlyContribution: Decimal.fromMinorUnits(
      BigInt(plan.monthlyContributionCents),
      SCALE_CENTS,
    ).toFloat(),
    annualSpend: Decimal.fromMinorUnits(BigInt(plan.annualSpendCents), SCALE_CENTS).toFloat(),
    swrPercent: plan.swrBps / 100,
    preset: plan.preset,
  };

  if (plan.preset === "custom") {
    return {
      ...base,
      muPercent: plan.muBps / 100,
      sigmaPercent: plan.sigmaBps / 100,
      stockWeightPercent: plan.stockWeightBps / 100,
    };
  }

  return base;
}

const EMPTY_DEFAULTS: Partial<PlanFormValues> = {
  swrPercent: 4,
  planUntilAge: 95,
  preset: "balanced",
  monthlyContribution: 0,
};

// ---------------------------------------------------------------------------
// PlanScreen
// ---------------------------------------------------------------------------

export function PlanScreen() {
  const accountsQuery = useAccountsQuery();
  const planQuery = usePlanRecord();
  const { holdings } = useHoldingsQuery();

  // Route tickers for prices (investment account holdings need current market value).
  const { yahooTickers, coingeckoTickers } = useMemo(() => {
    const yahoo = new Set<string>();
    const coingecko = new Set<string>();
    for (const h of holdings) {
      if (h.proxyTicker !== null) yahoo.add(h.proxyTicker);
      else if (h.assetType === "crypto") coingecko.add(h.ticker);
      else yahoo.add(h.ticker);
    }
    return { yahooTickers: [...yahoo], coingeckoTickers: [...coingecko] };
  }, [holdings]);
  const { prices } = usePricesQuery({ yahooTickers, coingeckoTickers });

  // Derive liquid pot from loaded accounts + holdings + prices.
  const potResult = useMemo(() => {
    if (accountsQuery.status !== "success") return null;
    // Hold while any priced holding still lacks a price entry: computing with
    // a missing price values that holding at $0 and pre-fills an undercounted
    // pot (same guard as the dashboard's compute effect).
    if (holdings.some((h) => prices.get(h.proxyTicker ?? h.ticker) === undefined)) {
      return null;
    }
    // Rehydrate LocalHolding into the domain Holding shape computeNetWorth takes.
    const domainHoldings: Holding[] = holdings.map((h) => ({
      id: asId<HoldingId>(h.id),
      userId: asId(""),
      createdAt: asIsoDateTime(new Date(h.updatedAt).toISOString()),
      updatedAt: asIsoDateTime(new Date(h.updatedAt).toISOString()),
      payload: {
        accountId: asId(h.accountId),
        groupId: h.groupId === null ? null : asId<HoldingGroupId>(h.groupId),
        ticker: h.ticker,
        assetType: h.assetType,
        proxyTicker: h.proxyTicker,
        name: h.name,
        sharesMajor: h.sharesMajor,
        sharesScale: h.sharesScale,
        costBasisCents: h.costBasisCents,
        scaleFactor: h.scaleFactor,
      },
    }));
    return deriveLiquidPot({ accounts: accountsQuery.data, holdings: domainHoldings, prices });
  }, [accountsQuery, holdings, prices]);

  // Seed: stable within session; loaded from saved plan when one exists.
  const sessionSeedRef = useRef<string | null>(null);
  const seed = useMemo(() => {
    if (planQuery.status === "success") {
      return planQuery.data.payload.seed;
    }
    if (sessionSeedRef.current === null) {
      sessionSeedRef.current = generateSeed();
    }
    return sessionSeedRef.current;
  }, [planQuery]);

  // Saved-plan form values (full), or null when no plan exists yet.
  const savedValues = useMemo<PlanFormValues | null>(() => {
    if (planQuery.status === "success") return planToFormValues(planQuery.data.payload);
    return null;
  }, [planQuery]);

  // Single source of truth for the live plan inputs. Both the Adjust form and
  // the levers write here; the headline, chart, confidence, and milestones all
  // recompute from the resulting simulation.
  const [workingValues, setWorkingValues] = useState<PlanFormValues | null>(null);
  // Saved-plan baseline: lever ranges scale to it, and the sooner/later delta is
  // measured against its FIRE age. Captured on the first run, reset on save.
  const [baseline, setBaseline] = useState<{
    values: PlanFormValues;
    fireAge: number;
    neverFi: boolean;
  } | null>(null);
  // True while the Adjust editor is open, so the levers hide (they edit the same
  // plan and must not be driven simultaneously).
  const [editing, setEditing] = useState(false);

  // The result is stored with the input it was computed from, so display props
  // (age axis, already-FI headline) always match the run.
  const [sim, setSim] = useState<{ result: SimulateResult; input: SimWorkerInput } | null>(null);
  const [computing, setComputing] = useState(false);
  // Set when a run fails and there is no prior result to keep showing; drives
  // the retry affordance so a first-run failure never sits as an endless skeleton.
  const [simFailed, setSimFailed] = useState(false);
  // Minimum inputs present (form filled or saved plan loaded); gates the skeleton.
  const [hasMinInputs, setHasMinInputs] = useState(false);

  const lastInputRef = useRef<SimWorkerInput | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation counter: guards against stale in-flight runs overwriting newer results.
  const genRef = useRef(0);
  // Latest computed sim, readable synchronously in handleSave without making it a
  // dependency (so the baseline snapshots the result shown at save time).
  const simRef = useRef(sim);
  simRef.current = sim;
  // Guards against overlapping saves (a mobile double-tap before the button disables).
  const savingRef = useRef(false);

  // Seed the working values from a saved plan on first load.
  useEffect(() => {
    if (savedValues !== null && workingValues === null) {
      setWorkingValues(savedValues);
      setHasMinInputs(true);
    }
  }, [savedValues, workingValues]);

  const runSimulation = useCallback(async (input: SimWorkerInput, values: PlanFormValues) => {
    lastInputRef.current = input;
    const myGen = ++genRef.current;
    setComputing(true);
    setSimFailed(false);
    try {
      const result = await simulate(input);
      if (genRef.current !== myGen) return;
      setSim({ result, input });
      const neverFi = isNeverFiState(
        result.mc.medianFireAge,
        input.planUntilAge,
        result.mc.neverFiFraction,
      );
      // First successful run anchors the baseline (no plan saved yet, or the
      // saved plan loaded). Later runs leave it; save resets it explicitly.
      setBaseline((prev) => prev ?? { values, fireAge: result.mc.medianFireAge, neverFi });
    } catch {
      // Keep any prior result visible; flag failure so the no-result state offers
      // a retry instead of an endless skeleton.
      if (genRef.current === myGen) setSimFailed(true);
    } finally {
      if (genRef.current === myGen) setComputing(false);
    }
  }, []);

  // Recompute whenever the working values or the pot change (debounced). One
  // path serves both the form and the levers, so every edit updates the whole
  // page together.
  useEffect(() => {
    if (workingValues === null || potResult === null) return;
    const input = formToSimInput(workingValues, potResult.potCents, seed);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSimulation(input, workingValues);
    }, 300);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [workingValues, potResult, seed, runSimulation]);

  const handleFormChange = useCallback((values: PlanFormValues) => {
    setHasMinInputs(true);
    setWorkingValues((prev) => (prev !== null && samePlanValues(prev, values) ? prev : values));
  }, []);

  const handleLeverChange = useCallback((patch: Partial<PlanFormValues>) => {
    setWorkingValues((v) => (v === null ? v : { ...v, ...patch }));
  }, []);

  const { savePlan, state: saveState } = useSavePlan();

  const handleSave = useCallback(
    async (values: PlanFormValues) => {
      if (savingRef.current) return;
      savingRef.current = true;
      // Snapshot the result shown at save time before awaiting, so a sim that
      // resolves during the save cannot re-anchor the baseline to a newer run.
      const snapshot = simRef.current;
      try {
        const payload = formToPayload(values, seed);
        await savePlan(payload);
        // The saved plan (with the result it was showing) becomes the new baseline.
        if (snapshot !== null) {
          const neverFi = isNeverFiState(
            snapshot.result.mc.medianFireAge,
            snapshot.input.planUntilAge,
            snapshot.result.mc.neverFiFraction,
          );
          setBaseline({ values, fireAge: snapshot.result.mc.medianFireAge, neverFi });
        }
      } finally {
        savingRef.current = false;
      }
    },
    [savePlan, seed],
  );

  // Cleanup debounce on unmount; bump generation so any in-flight run is ignored.
  useEffect(() => {
    return () => {
      genRef.current++;
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isLoading = accountsQuery.status === "initialising" || planQuery.status === "initialising";
  const excludedAccounts = potResult?.excludedAccounts ?? [];

  return (
    <Screen width="wide">
      {/* Matches the inter-section gap inside ResultsPanel so the vertical rhythm
          between every main section (hero, assumptions, chart, confidence,
          milestones, levers) is even. Tighter on mobile where space is scarce. */}
      <div className="flex flex-col gap-7 md:gap-9">
        {/* Answer headline leads the page (no page-name label, like a result) */}
        {sim !== null ? (
          <PlanHeadline
            medianFireAge={sim.result.mc.medianFireAge}
            fireNumber={sim.result.fireNumber}
            potCents={sim.input.startingPotCents}
            neverFiFraction={sim.result.mc.neverFiFraction}
            planUntilAge={sim.input.planUntilAge}
          />
        ) : (
          <div>
            <h1
              className="font-serif text-[40px] md:text-[46px] leading-tight font-light tracking-[-0.015em] text-app-muted"
              style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
            >
              Project your path to financial independence.
            </h1>
            <p className="mt-2 text-sm text-app-muted">
              Enter your assumptions below to see when your money reaches your target.
            </p>
          </div>
        )}

        {/* Currency exclusion disclosure */}
        {excludedAccounts.length > 0 && (
          <div
            role="note"
            aria-label="Currency exclusion notice"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-app-muted"
          >
            <span className="font-medium text-app-text">Not simulated: </span>
            {excludedAccounts.map((a) => `${a.name} (${a.currency})`).join(", ")}
            <span className="block mt-1 text-xs">
              Only {potResult?.primaryCurrency ?? ""} accounts are included in the projected
              portfolio.
            </span>
          </div>
        )}

        {/* Corrupt/unreadable plan record notice */}
        {planQuery.status === "error" && (
          <div
            role="note"
            aria-label="Plan load error"
            className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-app-muted"
          >
            Your saved plan could not be loaded. It may have been saved by a newer version of
            Privance.
          </div>
        )}

        {/* Assumptions bar */}
        {!isLoading && (
          <AssumptionsBar
            key={planQuery.status === "success" ? planQuery.data.id : "no-plan"}
            summary={{
              potCents: potResult?.potCents ?? null,
              values: workingValues ?? savedValues,
            }}
            defaultExpanded={planQuery.status !== "success"}
            showStartingPot={sim === null}
            manualAssetsCents={potResult?.manualAssetsCents}
            liabilitiesCents={potResult?.liabilitiesCents}
            // Restore last entered values on re-mount so collapse or a failed
            // save never drops unsaved edits.
            defaultValues={workingValues ?? savedValues ?? EMPTY_DEFAULTS}
            onChange={handleFormChange}
            onSave={handleSave}
            saving={saveState === "pending"}
            saveDisabled={planQuery.status === "error"}
            onExpandedChange={setEditing}
          />
        )}

        {/* Results area */}
        {!hasMinInputs && (
          <section
            className="rounded-xl border border-app-line bg-app-panel p-8 flex flex-col items-center justify-center min-h-[300px] text-center"
            aria-label="Results placeholder"
          >
            <p className="text-app-muted text-sm">
              Enter your annual spend and ages to see projections.
            </p>
          </section>
        )}

        {hasMinInputs && sim === null && !simFailed && (
          <div className="flex flex-col gap-7 md:gap-9">
            <FanChartSkeleton />
            <ResultsSkeleton />
          </div>
        )}

        {hasMinInputs && sim === null && simFailed && (
          <section
            role="alert"
            aria-label="Projection error"
            className="rounded-xl border border-app-red/40 bg-app-red/10 p-8 flex flex-col items-center justify-center gap-3 min-h-[300px] text-center"
          >
            <p className="text-sm text-app-text">The projection could not be computed.</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                if (lastInputRef.current !== null && workingValues !== null) {
                  void runSimulation(lastInputRef.current, workingValues);
                }
              }}
            >
              Try again
            </Button>
          </section>
        )}

        {sim !== null && workingValues !== null && baseline !== null && (
          <ResultsPanel
            result={sim.result}
            input={sim.input}
            computing={computing}
            workingValues={workingValues}
            baselineValues={baseline.values}
            baselineFireAge={baseline.fireAge}
            baselineNeverFi={baseline.neverFi}
            onLeverChange={handleLeverChange}
            hideLevers={editing}
          />
        )}
      </div>
    </Screen>
  );
}
