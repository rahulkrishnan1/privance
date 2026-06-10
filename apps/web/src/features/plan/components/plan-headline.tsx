"use client";

import { Decimal } from "@privance/core";
import { formatCurrencyWhole } from "@/lib/format";
import { isNeverFiState } from "../types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type PlanHeadlineProps = {
  medianFireAge: number;
  fireNumber: Decimal;
  potCents: Decimal;
  neverFiFraction: number;
  planUntilAge: number;
};

// ---------------------------------------------------------------------------
// Priority: alreadyFi > neverFi > normal
// ---------------------------------------------------------------------------

type HeadlineState = "alreadyFi" | "neverFi" | "normal";

function deriveState(
  potCents: Decimal,
  fireNumber: Decimal,
  medianFireAge: number,
  planUntilAge: number,
  neverFiFraction: number,
): HeadlineState {
  const alreadyFi = potCents.cmp(fireNumber) >= 0;
  if (alreadyFi) return "alreadyFi";
  if (isNeverFiState(medianFireAge, planUntilAge, neverFiFraction)) return "neverFi";
  return "normal";
}

// ---------------------------------------------------------------------------
// Anchors: where you are today vs the target, with progress toward it.
// ---------------------------------------------------------------------------

const headlineStyle: React.CSSProperties = { fontVariationSettings: '"opsz" 48, "SOFT" 50' };
const H1 =
  "font-serif text-[40px] md:text-[46px] leading-tight font-light tracking-[-0.015em] text-app-text";

const HUNDRED = Decimal.fromString("100");

function Anchors({ potCents, fireNumber }: { potCents: Decimal; fireNumber: Decimal }) {
  const reached = potCents.cmp(fireNumber) >= 0;
  // Keep the progress ratio in Decimal; cross to float only for the CSS width.
  const ratioPct = fireNumber.isZero() ? 0 : potCents.div(fireNumber).mul(HUNDRED).toFloat();
  const pct = Math.min(100, Math.max(0, ratioPct));
  const pctLabel = Math.max(1, Math.round(pct));

  return (
    <div className="mt-7 max-w-xl">
      <div className="flex items-end justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">Today</p>
          <p className="mt-2 text-[22px] font-medium tabular-nums text-app-text">
            {formatCurrencyWhole(potCents)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">Target</p>
          <p className="mt-2 text-[22px] font-medium tabular-nums text-gold-accent">
            {formatCurrencyWhole(fireNumber)}
          </p>
        </div>
      </div>
      <div className="mt-4 h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-gold-accent/50 to-gold-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2.5 text-[13px] text-app-dim">
        {reached ? "You've reached your number" : `About ${pctLabel}% of the way to your number`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanHeadline
// ---------------------------------------------------------------------------

export function PlanHeadline({
  medianFireAge,
  fireNumber,
  potCents,
  neverFiFraction,
  planUntilAge,
}: PlanHeadlineProps) {
  const state = deriveState(potCents, fireNumber, medianFireAge, planUntilAge, neverFiFraction);

  return (
    <div aria-live="polite" aria-atomic="true">
      <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent mb-2.5">
        Your plan
      </p>
      {state === "normal" && (
        <h1 className={H1} style={headlineStyle}>
          FIRE at{" "}
          <span className="text-gold-accent" data-testid="fire-age-value">
            {medianFireAge}
          </span>
          .
        </h1>
      )}
      {state === "alreadyFi" && (
        <h1 className={H1} style={headlineStyle}>
          You&apos;re financially independent <span className="text-gold-accent">today</span>.
        </h1>
      )}
      {state === "neverFi" && (
        <h1 className={H1} style={headlineStyle}>
          FIRE not on this path<span className="text-app-red">.</span>
        </h1>
      )}

      <Anchors potCents={potCents} fireNumber={fireNumber} />
    </div>
  );
}
