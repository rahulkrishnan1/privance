"use client";

import type { Holding, HoldingGroupId, HoldingId, PlanPayload } from "@privance/core";
import { asId, asIsoDateTime, Decimal, SCALE_CENTS } from "@privance/core";
import type { SimulateResult } from "@privance/core/projection";
import { DATASET_START_YEAR, PRESET_BALANCED } from "@privance/core/projection";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Screen } from "@/components/index";
import { useAccountsQuery } from "@/features/accounts/queries";
import { useHoldingsQuery } from "@/features/holdings/queries";
import { usePricesQuery } from "@/lib/queries/prices";
import type { SimWorkerInput } from "@/lib/sim/worker-client";
import { simulate } from "@/lib/sim/worker-client";
import { AdjustPanel } from "./components/adjust-panel";
import { MilestonesSection } from "./components/milestones-section";
import { PlanHeadline, type SimMethod } from "./components/plan-headline";
import { FanChartSkeleton, PlanHeadlineSkeleton } from "./components/skeletons";
import { useSavePlan } from "./mutations";
import { deriveLiquidPot } from "./pot";
import { usePlanRecord } from "./queries";
import { payloadToSimInput } from "./sim-input";
import { isNeverFiState, type PlanFormValues, samePlanValues } from "./types";

// Lazy-load the fan chart so Recharts is not in the initial bundle.
const FanChart = dynamic(
  () => import("./components/fan-chart").then((m) => ({ default: m.FanChart })),
  {
    ssr: false,
    loading: () => <FanChartSkeleton />,
  },
);

function generateSeed(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromDollars(dollars: number): Decimal {
  return Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS);
}

function formToPayload(values: PlanFormValues, seed: string): PlanPayload {
  const base = {
    schemaVersion: 2 as const,
    currentAge: values.currentAge,
    planUntilAge: values.planUntilAge,
    monthlyContributionCents: Decimal.fromString((values.monthlyContribution ?? 0).toFixed(2))
      .toMinorUnits()
      .toString(),
    annualSpendCents: Decimal.fromString(values.annualSpend.toFixed(2)).toMinorUnits().toString(),
    swrBps: Math.round(values.swrPercent * 100),
    seed,
    ...(values.manualStartingDollars !== undefined
      ? {
          manualStartingPotCents: Decimal.fromString(values.manualStartingDollars.toFixed(2))
            .toMinorUnits()
            .toString(),
        }
      : {}),
  };

  if (values.preset === "custom") {
    return {
      ...base,
      preset: "custom" as const,
      muBps: Math.round((values.muPercent ?? PRESET_BALANCED.muBps / 100) * 100),
      sigmaBps: Math.round((values.sigmaPercent ?? PRESET_BALANCED.sigmaBps / 100) * 100),
      stockWeightBps: Math.round(
        (values.stockWeightPercent ?? PRESET_BALANCED.stockWeight * 100) * 100,
      ),
    };
  }

  return { ...base, preset: values.preset };
}

function formToSimInput(values: PlanFormValues, potCents: Decimal, seed: string): SimWorkerInput {
  return payloadToSimInput(formToPayload(values, seed), potCents);
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
    ...(plan.manualStartingPotCents !== undefined
      ? {
          manualStartingDollars: Decimal.fromMinorUnits(
            BigInt(plan.manualStartingPotCents),
            SCALE_CENTS,
          ).toFloat(),
        }
      : {}),
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

// Auto-seeded for a first-time user who already has accounts: the panel opens
// straight away with the account-derived pot, like the shipped app did.
const ACCOUNT_DEFAULTS: PlanFormValues = {
  currentAge: 35,
  planUntilAge: 95,
  monthlyContribution: 0,
  annualSpend: 40000,
  swrPercent: 4,
  preset: "balanced",
};

export function PlanScreen() {
  const router = useRouter();
  const accountsQuery = useAccountsQuery();
  const planQuery = usePlanRecord();
  const { holdings } = useHoldingsQuery();

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
  const { prices, isLoading: pricesLoading } = usePricesQuery({ yahooTickers, coingeckoTickers });

  const potResult = useMemo(() => {
    if (accountsQuery.status !== "success") return null;
    // Wait while prices are loading for the first time, but never block forever
    // on a holding whose price never resolves (delisted or unknown ticker): once
    // the fetch settles, value what resolved and let computeNetWorth leave the
    // unpriced holding out rather than wedging the whole projection on a skeleton.
    if (pricesLoading && holdings.length > 0) return null;
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
  }, [accountsQuery, holdings, prices, pricesLoading]);

  const sessionSeedRef = useRef<string | null>(null);
  const seed = useMemo(() => {
    if (planQuery.status === "success") return planQuery.data.payload.seed;
    if (sessionSeedRef.current === null) sessionSeedRef.current = generateSeed();
    return sessionSeedRef.current;
  }, [planQuery]);

  const savedValues = useMemo<PlanFormValues | null>(() => {
    if (planQuery.status === "success") return planToFormValues(planQuery.data.payload);
    return null;
  }, [planQuery]);

  const [workingValues, setWorkingValues] = useState<PlanFormValues | null>(null);
  // Saved-plan baseline: slider ranges scale to its values, and the lever
  // readout measures sooner/later against its FIRE age. Anchored on the first
  // settled sim (so fireAge/neverFi reflect a real run), reset on save.
  const [baseline, setBaseline] = useState<{
    values: PlanFormValues;
    fireAge: number;
    neverFi: boolean;
  } | null>(null);
  const [method, setMethod] = useState<SimMethod>("mc");

  const [sim, setSim] = useState<{ result: SimulateResult; input: SimWorkerInput } | null>(null);
  const [computing, setComputing] = useState(false);
  const [simFailed, setSimFailed] = useState(false);
  const [hasMinInputs, setHasMinInputs] = useState(false);

  const lastInputRef = useRef<SimWorkerInput | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);
  const savingRef = useRef(false);
  // Latest sim, readable synchronously in handleSave so the new baseline
  // snapshots the result shown at save time without making it a dependency.
  const simRef = useRef(sim);
  simRef.current = sim;

  // Seed working values from a saved plan on first load. The baseline is left
  // for runSimulation to anchor once the first sim settles.
  useEffect(() => {
    if (savedValues !== null && workingValues === null) {
      setWorkingValues(savedValues);
      setHasMinInputs(true);
    }
  }, [savedValues, workingValues]);

  // First-time user who already has accounts: open the panel with the
  // account-derived pot instead of the empty state (which is for no-accounts).
  useEffect(() => {
    // Seed once the plan is settled with no usable saved values ("none", or
    // "error" so the corrupt-record path still gets a working panel). Never
    // while "initialising": seeding then would block a saved plan from loading.
    if (planQuery.status === "initialising" || planQuery.status === "success") return;
    if (workingValues !== null || hasMinInputs) return;
    if (potResult !== null && !potResult.potCents.isZero()) {
      setWorkingValues(ACCOUNT_DEFAULTS);
      setHasMinInputs(true);
    }
  }, [planQuery.status, potResult, workingValues, hasMinInputs]);

  const runSimulation = useCallback(async (input: SimWorkerInput, values: PlanFormValues) => {
    lastInputRef.current = input;
    const myGen = ++genRef.current;
    setComputing(true);
    setSimFailed(false);
    try {
      const result = await simulate(input);
      if (genRef.current !== myGen) return;
      setSim({ result, input });
      // First settled run anchors the baseline; later runs leave it, and save
      // resets it explicitly.
      setBaseline(
        (prev) =>
          prev ?? {
            values,
            fireAge: result.mc.medianFireAge,
            neverFi: isNeverFiState(
              result.mc.medianFireAge,
              input.planUntilAge,
              result.mc.neverFiFraction,
            ),
          },
      );
    } catch {
      if (genRef.current === myGen) setSimFailed(true);
    } finally {
      if (genRef.current === myGen) setComputing(false);
    }
  }, []);

  // The effective starting pot: manual amount when set, else the account-derived
  // pot (manual mode can run with no accounts, to explore the math first).
  // Memoised so its identity is stable: an inline `fromDollars` would mint a new
  // Decimal every render and, in manual mode where nothing else re-anchors it,
  // reschedule the debounced sim forever.
  const manualSet = workingValues?.manualStartingDollars !== undefined;
  const effectivePot = useMemo(
    () =>
      manualSet
        ? fromDollars(workingValues?.manualStartingDollars ?? 0)
        : (potResult?.potCents ?? null),
    [manualSet, workingValues?.manualStartingDollars, potResult],
  );

  // Recompute whenever the working values or pot change (debounced).
  useEffect(() => {
    if (workingValues === null || effectivePot === null) return;
    const input = formToSimInput(workingValues, effectivePot, seed);
    if (lastInputRef.current === null) {
      void runSimulation(input, workingValues);
      return;
    }
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSimulation(input, workingValues), 300);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [workingValues, effectivePot, seed, runSimulation]);

  const handleChange = useCallback((patch: Partial<PlanFormValues>) => {
    setWorkingValues((v) => {
      if (v === null) return v;
      const next = { ...v, ...patch };
      return samePlanValues(v, next) ? v : next;
    });
  }, []);

  const { savePlan, state: saveState } = useSavePlan();

  const handleSave = useCallback(async () => {
    if (savingRef.current || workingValues === null) return;
    savingRef.current = true;
    // Snapshot the result shown at save time before awaiting, so a sim that
    // resolves mid-save can't re-anchor the new baseline to a newer run.
    const snapshot = simRef.current;
    try {
      await savePlan(formToPayload(workingValues, seed));
      if (snapshot !== null) {
        setBaseline({
          values: workingValues,
          fireAge: snapshot.result.mc.medianFireAge,
          neverFi: isNeverFiState(
            snapshot.result.mc.medianFireAge,
            snapshot.input.planUntilAge,
            snapshot.result.mc.neverFiFraction,
          ),
        });
      }
    } catch {
      // savePlan surfaces the failure via saveState === "error" (rendered below);
      // swallow here so the click handler's promise doesn't reject unhandled.
    } finally {
      savingRef.current = false;
    }
  }, [savePlan, seed, workingValues]);

  useEffect(() => {
    return () => {
      genRef.current++;
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  const isLoading = accountsQuery.status === "initialising" || planQuery.status === "initialising";
  const excludedAccounts = potResult?.excludedAccounts ?? [];
  const showEmpty = !isLoading && planQuery.status !== "success" && !hasMinInputs;

  const headlineState: "normal" | "alreadyFi" | "neverFi" = (() => {
    if (sim === null) return "normal";
    if (sim.input.startingPotCents.cmp(sim.result.fireNumber) >= 0) return "alreadyFi";
    if (
      isNeverFiState(
        sim.result.mc.medianFireAge,
        sim.input.planUntilAge,
        sim.result.mc.neverFiFraction,
      )
    )
      return "neverFi";
    return "normal";
  })();

  const currentYear = new Date().getFullYear();
  // Calendar year the median reaches FI; shared by the headline and the chart
  // marker. Only read where sim is present.
  const fireYear =
    sim !== null ? currentYear + (sim.result.mc.medianFireAge - sim.input.currentAge) : currentYear;
  // Dirty against the persisted plan (not the baseline used for slider ranges):
  // a never-saved plan is always dirty, so its first Save is offered.
  const dirty =
    workingValues !== null && (savedValues === null || !samePlanValues(workingValues, savedValues));

  return (
    <Screen width="wide">
      <div className="flex flex-col gap-4">
        {sim !== null ? (
          <PlanHeadline
            state={headlineState}
            fireAge={sim.result.mc.medianFireAge}
            fireYear={fireYear}
            annualSpendCents={sim.input.annualSpendCents}
            potCents={sim.input.startingPotCents}
            fireNumber={sim.result.fireNumber}
            successRate={sim.result.mc.successRate}
            survivalShare={sim.result.replay.survivalShare}
            method={method}
            onMethodChange={setMethod}
          />
        ) : showEmpty ? null : (
          <PlanHeadlineSkeleton />
        )}

        {excludedAccounts.length > 0 && (
          <div
            role="note"
            aria-label="Currency exclusion notice"
            className="rounded-xl border border-signal/30 bg-signal/5 px-4 py-3 text-sm text-cream-soft"
          >
            <span className="font-medium text-cream">Not simulated: </span>
            {excludedAccounts.map((a) => `${a.name} (${a.currency})`).join(", ")}
            <span className="mt-1 block text-xs">
              Only {potResult?.primaryCurrency ?? ""} accounts are included in the projected
              portfolio.
            </span>
          </div>
        )}

        {planQuery.status === "error" && (
          <div
            role="note"
            aria-label="Plan load error"
            className="rounded-xl border border-signal/30 bg-signal/5 px-4 py-3 text-sm text-cream-soft"
          >
            Your saved plan could not be loaded. It may have been saved by a newer version of
            Privance.
          </div>
        )}

        {showEmpty && (
          <section className="px-6 pb-20 pt-9 text-center" aria-label="Project your path">
            <div className="mx-auto mb-7 flex h-[84px] w-[84px] items-center justify-center rounded-full border border-dashed border-cream/20 text-accent">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
                className="h-[30px] w-[30px]"
              >
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="5" />
                <circle cx="12" cy="12" r="1.5" />
              </svg>
            </div>
            <h2 className="font-serif text-4xl font-normal tracking-[-0.01em]">
              Project your path to <em className="text-accent">independence.</em>
            </h2>
            <p className="text-dim mx-auto mt-3 max-w-[44ch] text-base">
              Privance models your future from what you have today. Add accounts and it pulls your
              balance in automatically.
            </p>
            <button
              type="button"
              onClick={() => router.push("/app/accounts/")}
              className="mt-7 inline-block cursor-pointer rounded-md bg-accent px-[26px] py-3.5 font-mono text-xs uppercase tracking-button text-vault transition-colors hover:bg-cream"
            >
              Add accounts
            </button>
          </section>
        )}

        {!showEmpty && sim === null && !simFailed && <FanChartSkeleton />}

        {!showEmpty && sim === null && simFailed && (
          <section
            role="alert"
            aria-label="Projection error"
            className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-[10px] border border-down/40 bg-down/10 p-8 text-center"
          >
            <p className="text-sm text-cream">The projection could not be computed.</p>
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

        {sim !== null && (
          <section aria-label="Portfolio projection">
            {computing && (
              <div
                role="status"
                aria-label="Recomputing projections"
                className="mb-3 flex items-center gap-2 text-xs text-cream-soft"
              >
                <svg
                  aria-hidden="true"
                  className="h-3.5 w-3.5 animate-spin text-accent"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span>Updating projection&hellip;</span>
              </div>
            )}
            <FanChart
              bands={sim.result.mc.yearlyBands}
              startAge={sim.input.currentAge}
              className="w-full"
              fireNumberDisplay={sim.result.fireNumber.toFloat()}
              startingPot={sim.input.startingPotCents}
              medianFireAge={sim.result.mc.medianFireAge}
              fireYear={fireYear}
              planUntilAge={sim.input.planUntilAge}
            />
            <p className="mt-3 font-mono text-xs leading-relaxed text-faint">
              {method === "mc"
                ? "Percentile bands from 1,000 simulated futures, drawn on your allocation's return and volatility."
                : `Your plan replayed through every market stretch since ${DATASET_START_YEAR}, crashes and recoveries included.`}
            </p>
          </section>
        )}

        {sim !== null && workingValues !== null && baseline !== null && (
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-8">
              <AdjustPanel
                values={workingValues}
                potCents={potResult?.potCents ?? null}
                baseline={baseline.values}
                currentFireAge={sim.result.mc.medianFireAge}
                currentNeverFi={headlineState === "neverFi"}
                baselineFireAge={baseline.fireAge}
                baselineNeverFi={baseline.neverFi}
                dirty={dirty}
                saving={saveState === "pending"}
                saveError={saveState === "error"}
                saveDisabled={planQuery.status === "error"}
                onChange={handleChange}
                onSave={handleSave}
              />
            </div>
            <div className="col-span-12 lg:col-span-4">
              <MilestonesSection
                result={sim.result}
                input={sim.input}
                currentYear={currentYear}
                neverFi={headlineState === "neverFi"}
              />
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
