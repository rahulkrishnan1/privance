"use client";

import { Decimal } from "@privance/core";
import { DATASET_START_YEAR } from "@privance/core/projection";
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
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">Today</span>
          <span className="vfig font-mono text-[13px] tabular-nums" data-testid="starting-pot">
            {formatCurrencyWhole(potCents)}
          </span>
        </span>
        <span className="self-center font-mono text-[10px] uppercase tracking-[0.1em] text-accent max-[560px]:hidden">
          {pctLabel}% of the way
        </span>
        <span className="flex flex-col items-end gap-[3px] text-right">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
            FI number
          </span>
          <span
            className="vfig font-mono text-[13px] tabular-nums text-accent"
            data-testid="fire-number"
          >
            {formatCurrencyWhole(fireNumber)}
          </span>
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[rgba(235,235,230,0.08)]">
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
      {/* biome-ignore lint/a11y/useSemanticElements: a labelled toggle-button
          group is the correct ARIA pattern here; <fieldset> would impose its own
          box model on this inline segmented control. */}
      <div
        className="flex gap-0.5 rounded-lg border border-line bg-panel p-[3px]"
        role="group"
        aria-label="Projection method"
      >
        {(
          [
            ["mc", "Monte Carlo"],
            ["hist", "Historical replay"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={method === m}
            onClick={() => onMethodChange(m)}
            className={[
              "rounded-md px-3.5 py-[7px] font-mono text-[10px] uppercase tracking-[0.1em] transition-colors cursor-pointer",
              method === m ? "bg-panel-2 text-cream" : "text-faint hover:text-cream",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="h-1.5 min-w-[160px] max-w-[240px] flex-1 overflow-hidden rounded-full bg-[rgba(235,235,230,0.08)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-[width] duration-[400ms] ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[11.5px] tracking-[0.04em] text-dim" aria-live="polite">
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
  "font-serif font-normal text-[clamp(38px,5.6vw,62px)] leading-[1.04] tracking-[-0.015em] max-w-[21ch]";

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
      <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-faint">The plan</p>

      {state === "normal" && (
        <h1 className={`${H1} mt-3.5`}>
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
        <p className="mt-6 text-[13px] text-cream-soft">
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
