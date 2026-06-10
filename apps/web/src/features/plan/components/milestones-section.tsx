"use client";

import { Decimal } from "@privance/core";
import type { Milestone, MilestoneKey, SimulateResult } from "@privance/core/projection";
import { computeMilestones, deriveAllocationParams } from "@privance/core/projection";
import { formatCurrencyCompact } from "@/lib/format";
import type { SimWorkerInput } from "@/lib/sim/worker-client";
import { isNeverFiState } from "../types";
import { InfoTip } from "./info-tip";

type MilestonesSectionProps = {
  result: SimulateResult;
  input: SimWorkerInput;
};

const TWELVE = Decimal.fromString("12");

const META: Record<MilestoneKey, { label: string; tip: string }> = {
  coast: {
    label: "Coast FIRE",
    tip: "Once your portfolio reaches this, you could stop saving entirely and still hit your number by 65 on growth alone.",
  },
  lean: {
    label: "Lean FIRE",
    tip: "A bare-bones version of independence, covering about 70% of your planned spending.",
  },
  fire: {
    label: "FIRE",
    tip: "Your target. Investments cover your full planned spending at your safe withdrawal rate.",
  },
  fat: {
    label: "Fat FIRE",
    tip: "A comfortable cushion, about 150% of your planned spending.",
  },
};

function whenLabel(m: Milestone): { text: string; muted: boolean } {
  if (m.age === null) return { text: "not in your plan", muted: true };
  return { text: `${m.fromAge ? "from" : "at"} age ${m.age}`, muted: false };
}

function MilestoneCard({ milestone, current }: { milestone: Milestone; current: boolean }) {
  const { label, tip } = META[milestone.key];
  const when = whenLabel(milestone);
  return (
    <div
      className={[
        "rounded-2xl border p-4",
        current ? "border-gold-accent/40 bg-gold-accent/[0.04]" : "border-app-line bg-app-panel",
      ].join(" ")}
    >
      <p
        className={[
          "font-mono text-[9px] tracking-[0.14em] uppercase flex items-center",
          current ? "text-gold-accent" : "text-app-dim",
        ].join(" ")}
      >
        {label}
        <InfoTip label={`What is ${label}?`} text={tip} />
      </p>
      <p
        className="mt-3 font-serif font-light text-[25px] leading-none tabular-nums text-app-text"
        style={{ fontVariationSettings: '"opsz" 36, "SOFT" 50' }}
      >
        {milestone.amountCents === null ? "·" : formatCurrencyCompact(milestone.amountCents)}
      </p>
      <p className={`mt-2 text-xs ${when.muted ? "text-app-muted" : "text-app-dim"}`}>
        {when.text}
      </p>
    </div>
  );
}

/**
 * "Your FIRE milestones": the Coast / Lean / FIRE / Fat ladder. FIRE is the
 * highlighted current target. Amounts and reach-ages come from the pure
 * `computeMilestones` core helper over the simulation result.
 */
export function MilestonesSection({ result, input }: MilestonesSectionProps) {
  const neverFi = isNeverFiState(
    result.mc.medianFireAge,
    input.planUntilAge,
    result.mc.neverFiFraction,
  );
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

  return (
    <section aria-label="Your FIRE milestones">
      <h2 className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim mb-4">
        Your FIRE milestones
      </h2>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        {milestones.map((m) => (
          <MilestoneCard key={m.key} milestone={m} current={m.key === "fire"} />
        ))}
      </div>
    </section>
  );
}
