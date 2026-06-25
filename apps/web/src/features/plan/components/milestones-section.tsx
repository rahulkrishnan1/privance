"use client";

import { Decimal } from "@privance/core";
import type { Milestone, MilestoneKey, SimulateResult } from "@privance/core/projection";
import { computeMilestones, deriveAllocationParams } from "@privance/core/projection";
import { formatCurrencyCompact } from "@/lib/format";
import type { SimWorkerInput } from "@/lib/sim/worker-client";

type MilestonesSectionProps = {
  result: SimulateResult;
  input: SimWorkerInput;
  /** Calendar year for `input.currentAge`, so milestone ages map to years. */
  currentYear: number;
  /** Whether the plan never reaches FI (shared with the headline). */
  neverFi: boolean;
};

const TWELVE = Decimal.fromString("12");

const META: Record<MilestoneKey, { label: string; desc: string }> = {
  coast: { label: "Coast FI", desc: "stop saving today and growth alone retires you by 65" },
  lean: { label: "Lean FI", desc: "a bare-bones budget, about 70% of your planned spend" },
  fire: { label: "FI", desc: "your full planned spend, work optional" },
  fat: { label: "Fat FI", desc: "a comfortable cushion, about 150% of your planned spend" },
};

function MilestoneRow({
  milestone,
  currentYear,
  currentAge,
  successPct,
  last,
}: {
  milestone: Milestone;
  currentYear: number;
  currentAge: number;
  successPct: number;
  last: boolean;
}) {
  const { label, desc } = META[milestone.key];
  const reached = milestone.age !== null && milestone.age <= currentAge;
  const year = milestone.age === null ? null : currentYear + (milestone.age - currentAge);
  const status =
    milestone.age === null
      ? "not in your plan"
      : reached
        ? "reached"
        : milestone.key === "fire"
          ? `${successPct}% confidence`
          : "median estimate";

  return (
    <div
      className={[
        "relative flex items-baseline gap-[18px] pl-[26px]",
        last ? "" : "pb-[26px]",
        "before:absolute before:left-[7px] before:top-[6px] before:bottom-0 before:w-px before:bg-line before:content-['']",
        last ? "before:hidden" : "",
      ].join(" ")}
    >
      <span
        className={[
          "absolute left-0 top-1 flex h-[15px] w-[15px] items-center justify-center rounded-full border",
          reached ? "border-accent bg-accent" : "border-accent-dim bg-vault",
        ].join(" ")}
      >
        <i
          className={["h-[5px] w-[5px] rounded-full", reached ? "bg-vault" : "bg-accent"].join(" ")}
        />
      </span>
      <span className="w-11 shrink-0 font-mono text-xs text-accent tabular-nums">
        {year ?? "-"}
      </span>
      <span className="min-w-0">
        <span className="text-sm text-cream">
          {label}
          {milestone.amountCents !== null && (
            <>
              {" · "}
              <span className="vfig text-cream-soft">
                {formatCurrencyCompact(milestone.amountCents)}
              </span>
            </>
          )}
        </span>
        <span className="mt-[3px] block font-mono text-xs text-faint">
          {status} · {desc}
        </span>
      </span>
    </div>
  );
}

/**
 * The Coast / Lean / FI / Fat ladder as a vertical timeline. Amounts and
 * reach-ages come from the pure `computeMilestones` core helper.
 */
export function MilestonesSection({ result, input, currentYear, neverFi }: MilestonesSectionProps) {
  const milestones = computeMilestones({
    fireNumberCents: result.fireNumber,
    startingPotCents: input.startingPotCents,
    currentAge: input.currentAge,
    planUntilAge: input.planUntilAge,
    medianFireAge: result.mc.medianFireAge,
    neverFi,
    yearlyBands: result.mc.yearlyBands,
    geoMeanBps: deriveAllocationParams(input.stockWeight).geoMeanBps,
    annualContributionCents: input.monthlyContributionCents.mul(TWELVE),
  });
  const successPct = Math.round(result.mc.successRate * 100);

  return (
    <div className="rounded-[10px] border border-line bg-panel p-6">
      <h3 className="mb-4 font-serif text-2xl font-normal tracking-[-0.005em]">Milestones</h3>
      {milestones.map((m, i) => (
        <MilestoneRow
          key={m.key}
          milestone={m}
          currentYear={currentYear}
          currentAge={input.currentAge}
          successPct={successPct}
          last={i === milestones.length - 1}
        />
      ))}
    </div>
  );
}
