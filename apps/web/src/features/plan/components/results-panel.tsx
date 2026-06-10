"use client";

import type { SimulateResult } from "@privance/core/projection";
import { DATASET_END_YEAR, DATASET_START_YEAR } from "@privance/core/projection";
import dynamic from "next/dynamic";
import { formatCurrencyWhole } from "@/lib/format";
import type { SimWorkerInput } from "@/lib/sim/worker-client";
import { isNeverFiState, type PlanFormValues } from "../types";
import { ConfidenceCard } from "./confidence-card";
import { LeversSection } from "./levers-section";
import { MilestonesSection } from "./milestones-section";
import { FanChartSkeleton } from "./skeletons";

// Lazy-load the fan chart so Recharts is not in the initial bundle.
const FanChart = dynamic(() => import("./fan-chart").then((m) => ({ default: m.FanChart })), {
  ssr: false,
  loading: () => <FanChartSkeleton />,
});

type ResultsPanelProps = {
  result: SimulateResult;
  /** The exact input the result was computed from; drives the chart, milestones, and levers. */
  input: SimWorkerInput;
  /** Whether a new simulation is currently computing (stale results shown below indicator). */
  computing?: boolean;
  /** Live working values driving the lever positions. */
  workingValues: PlanFormValues;
  /** Saved-plan baseline values (lever ranges) and result (sooner/later delta). */
  baselineValues: PlanFormValues;
  baselineFireAge: number;
  baselineNeverFi: boolean;
  /** Levers write to the shared working plan, recomputing everything. */
  onLeverChange: (patch: Partial<PlanFormValues>) => void;
  /** Hide the levers while the Adjust editor is open (they edit the same plan). */
  hideLevers?: boolean;
};

// ---------------------------------------------------------------------------
// ResultsPanel: chart -> confidence -> milestones -> levers
// ---------------------------------------------------------------------------

export function ResultsPanel({
  result,
  input,
  computing = false,
  workingValues,
  baselineValues,
  baselineFireAge,
  baselineNeverFi,
  onLeverChange,
  hideLevers = false,
}: ResultsPanelProps) {
  const { mc, replay } = result;
  // Off-track: the confidence numbers measure "money never depletes", which is
  // trivially ~100% when you never retire. Showing them would contradict the
  // headline, so surface the gap instead. Milestones and levers stay -- they
  // show how far the plan gets and what would close the gap.
  const neverFi = isNeverFiState(mc.medianFireAge, input.planUntilAge, mc.neverFiFraction);

  return (
    <div className="flex flex-col gap-7 md:gap-9">
      <div className="flex flex-col gap-3">
        {computing && (
          <div
            role="status"
            aria-label="Recomputing projections"
            className="flex items-center gap-2 text-xs text-app-muted"
          >
            <svg
              aria-hidden="true"
              className="w-3.5 h-3.5 animate-spin text-gold-accent"
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
          bands={mc.yearlyBands}
          startAge={input.currentAge}
          className="w-full"
          fireNumberDisplay={result.fireNumber.toFloat()}
          startingPot={input.startingPotCents}
          medianFireAge={mc.medianFireAge}
          planUntilAge={input.planUntilAge}
        />
      </div>

      {neverFi ? (
        <div className="rounded-2xl border border-app-line bg-app-panel p-5">
          <p className="text-sm text-app-text">
            Short of your <b>{formatCurrencyWhole(result.fireNumber)}</b> target at{" "}
            {input.planUntilAge}.
          </p>
          <p className="text-sm text-app-muted mt-1">
            Raising contributions or trimming spend closes the gap. Try the levers below.
          </p>
        </div>
      ) : (
        <ConfidenceCard
          successRate={mc.successRate}
          planUntilAge={input.planUntilAge}
          survivalShare={replay.survivalShare}
        />
      )}

      <MilestonesSection result={result} input={input} />

      {!hideLevers && (
        <LeversSection
          values={workingValues}
          baseline={baselineValues}
          currentFireAge={mc.medianFireAge}
          currentNeverFi={neverFi}
          baselineFireAge={baselineFireAge}
          baselineNeverFi={baselineNeverFi}
          onChange={onLeverChange}
        />
      )}

      <p className="-mt-4 text-[11px] text-app-dim">
        Based on US market history (S&amp;P 500 via Shiller), {DATASET_START_YEAR} to{" "}
        {DATASET_END_YEAR}, in today&apos;s dollars.
      </p>
    </div>
  );
}
