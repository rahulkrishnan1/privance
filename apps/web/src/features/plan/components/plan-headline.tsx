"use client";

import { Decimal } from "@privance/core";
import { DATASET_START_YEAR } from "@privance/core/projection";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatCurrencyWhole } from "@/lib/format";

export type SimMethod = "mc" | "hist";

type PlanHeadlineProps = {
  state: "normal" | "alreadyFi" | "neverFi";
  fireAge: number;
  fireYear: number;
  annualSpendCents: Decimal;
  potCents: Decimal;
  fireNumber: Decimal;
  successRate: number;
  survivalShare: number;
  method: SimMethod;
  onMethodChange: (m: SimMethod) => void;
};

const HUNDRED = Decimal.fromString("100");

function Progress({ potCents, fireNumber }: { potCents: Decimal; fireNumber: Decimal }) {
  const ratioPct = fireNumber.isZero() ? 0 : potCents.div(fireNumber).mul(HUNDRED).toFloat();
  const pct = Math.min(100, Math.max(0, ratioPct));
  const pctLabel = Math.max(1, Math.round(pct));
  return (
    <div className="mt-6 max-w-[680px]">
      <div className="flex items-end justify-between gap-3">
        <span className="flex flex-col gap-[3px]">
          <span className="font-mono text-xs uppercase tracking-label text-faint">Today</span>
          <span className="vfig font-mono text-sm tabular-nums" data-testid="starting-pot">
            {formatCurrencyWhole(potCents)}
          </span>
        </span>
        <span className="self-center font-mono text-xs uppercase tracking-label text-accent max-[560px]:hidden">
          {pctLabel}% of the way
        </span>
        <span className="flex flex-col items-end gap-[3px] text-right">
          <span className="font-mono text-xs uppercase tracking-label text-faint">FI number</span>
          <span
            className="vfig font-mono text-sm tabular-nums text-accent"
            data-testid="fire-number"
          >
            {formatCurrencyWhole(fireNumber)}
          </span>
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-cream/8">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Confidence({
  successRate,
  survivalShare,
  method,
  onMethodChange,
}: {
  successRate: number;
  survivalShare: number;
  method: SimMethod;
  onMethodChange: (m: SimMethod) => void;
}) {
  const value = method === "mc" ? successRate : survivalShare;
  const pct = Math.round(value * 100);
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3.5">
      <ToggleGroup
        type="single"
        value={method}
        onValueChange={(nv) => nv && onMethodChange(nv as SimMethod)}
        aria-label="Projection method"
        className="rounded-lg border border-line bg-panel p-[3px] gap-0.5"
      >
        <ToggleGroupItem value="mc" size="sm">
          Monte Carlo
        </ToggleGroupItem>
        <ToggleGroupItem value="hist" size="sm">
          Historical replay
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="h-1.5 min-w-[160px] max-w-[240px] flex-1 overflow-hidden rounded-full bg-cream/8">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-[width] duration-[400ms] ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs tracking-[0.04em] text-dim" aria-live="polite">
        <strong className="font-medium text-accent" data-testid="confidence-rate">
          {pct}%
        </strong>{" "}
        {method === "mc"
          ? "of 1,000 simulations never run out of money"
          : `of real markets since ${DATASET_START_YEAR} survived`}
      </span>
    </div>
  );
}

const H1 =
  "font-serif font-normal text-[clamp(38px,5.6vw,62px)] leading-[1.04] tracking-[-0.015em]";

export function PlanHeadline({
  state,
  fireAge,
  fireYear,
  annualSpendCents,
  potCents,
  fireNumber,
  successRate,
  survivalShare,
  method,
  onMethodChange,
}: PlanHeadlineProps) {
  return (
    <section aria-live="polite" aria-atomic="true">
      <p className="font-mono text-xs uppercase tracking-label text-faint">The plan</p>

      {state === "normal" && (
        <h1 className={`${H1} mt-3.5 max-w-[21ch]`}>
          Independent by{" "}
          <em className="text-accent" data-testid="fire-year">
            {fireYear}
          </em>
          , at age{" "}
          <em className="text-accent" data-testid="fire-age-value">
            {fireAge}
          </em>
          , spending <span className="vfig">{formatCurrencyWhole(annualSpendCents)}</span> a year.
        </h1>
      )}
      {state === "alreadyFi" && (
        <h1 className={`${H1} mt-3.5`}>
          You&apos;re financially independent <em className="text-accent">today</em>.
        </h1>
      )}
      {state === "neverFi" && (
        <h1 className={`${H1} mt-3.5`}>
          Independence isn&apos;t on this path <em className="text-signal">yet</em>.
        </h1>
      )}

      <Progress potCents={potCents} fireNumber={fireNumber} />

      {state === "neverFi" ? (
        <p className="mt-6 text-sm text-cream-soft">
          Short of your <span className="vfig font-medium">{formatCurrencyWhole(fireNumber)}</span>{" "}
          target. Raising contributions or trimming spend closes the gap.
        </p>
      ) : (
        <Confidence
          successRate={successRate}
          survivalShare={survivalShare}
          method={method}
          onMethodChange={onMethodChange}
        />
      )}
    </section>
  );
}
