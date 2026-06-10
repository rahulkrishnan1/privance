"use client";

import { deriveAllocationParams } from "@privance/core/projection";
import { ALLOCATION_SNAPS, type PlanFormValues, resolveStockPct } from "../types";

type LeversSectionProps = {
  /** Current working values; the levers read their positions from here. */
  values: PlanFormValues;
  /** Saved-plan baseline; lever ranges scale to it so the value sits mid-slider. */
  baseline: PlanFormValues;
  /** Current result, mirrored from the headline (lever age == headline age). */
  currentFireAge: number;
  currentNeverFi: boolean;
  /** Saved-plan baseline result; anchors the sooner/later delta. */
  baselineFireAge: number;
  baselineNeverFi: boolean;
  /** Live edit: levers write to the shared working values, recomputing everything. */
  onChange: (patch: Partial<PlanFormValues>) => void;
};

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Gold fill up to the value, grey beyond -- painted inline so it tracks live. */
function fillStyle(value: number, min: number, max: number): React.CSSProperties {
  const pct = max <= min ? 0 : ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return {
    backgroundImage: `linear-gradient(90deg, var(--color-gold-accent) ${pct}%, rgba(255,255,255,0.10) ${pct}%)`,
  };
}

// ---------------------------------------------------------------------------
// Lever card
// ---------------------------------------------------------------------------

function Lever({
  label,
  primary,
  secondary,
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
  ariaValueText,
  children,
}: {
  label: string;
  primary: React.ReactNode;
  secondary?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  ariaValueText: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-app-line bg-app-panel p-4">
      <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-app-dim">{label}</p>
      <p className="mt-2 text-[18px] md:text-[20px] font-semibold tabular-nums text-app-text">
        {primary}
      </p>
      {secondary !== undefined && <p className="mt-1 text-xs text-app-muted">{secondary}</p>}
      <div className="mt-auto pt-3.5">
        <input
          type="range"
          className="plan-range w-full"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          style={fillStyle(value, min, max)}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={ariaLabel}
          aria-valuetext={ariaValueText}
        />
        {/* Snap-label row reserved on every lever (empty unless allocation) so
            the sliders stay vertically aligned across all four cards. */}
        <div className="relative mt-3 h-3.5">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LeversSection
// ---------------------------------------------------------------------------

/**
 * "What moves your FIRE age": four live sliders. Each writes to the shared
 * working plan, so dragging recomputes the headline, chart, confidence, and
 * milestones together (the same model the Adjust form uses). The readout shows
 * the resulting FIRE age and a sooner/later delta against the saved plan.
 */
export function LeversSection({
  values,
  baseline,
  currentFireAge,
  currentNeverFi,
  baselineFireAge,
  baselineNeverFi,
  onChange,
}: LeversSectionProps) {
  const monthly = values.monthlyContribution ?? 0;
  const baseMonthly = baseline.monthlyContribution ?? 0;
  const monthlyMax = Math.max(roundTo(baseMonthly * 2.5, 500), 5000);
  const spendMin = Math.max(roundTo(baseline.annualSpend * 0.4, 1000), 1000);
  const spendMax = Math.max(roundTo(baseline.annualSpend * 2, 1000), spendMin + 1000);
  const stockPct = resolveStockPct(values);
  const expectedReturn = (deriveAllocationParams(stockPct / 100).muBps / 100).toFixed(1);

  const setAllocation = (pct: number) => {
    const params = deriveAllocationParams(pct / 100);
    onChange({
      preset: "custom",
      stockWeightPercent: pct,
      muPercent: params.muBps / 100,
      sigmaPercent: params.sigmaBps / 100,
    });
  };

  return (
    <section aria-label="What moves your FIRE age">
      <div className="mb-4 flex flex-col gap-2.5">
        <h2 className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
          What moves your FIRE age
        </h2>
        <LeverReadout
          currentFireAge={currentFireAge}
          currentNeverFi={currentNeverFi}
          baselineFireAge={baselineFireAge}
          baselineNeverFi={baselineNeverFi}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <Lever
          label="Monthly saving"
          primary={`$${Math.round(monthly).toLocaleString()}`}
          secondary="per month"
          min={0}
          max={monthlyMax}
          step={100}
          value={monthly}
          onChange={(v) => onChange({ monthlyContribution: v })}
          ariaLabel="Monthly saving"
          ariaValueText={`$${Math.round(monthly).toLocaleString()} per month`}
        />
        <Lever
          label="Annual spend"
          primary={`$${Math.round(values.annualSpend).toLocaleString()}`}
          secondary="per year"
          min={spendMin}
          max={spendMax}
          step={1000}
          value={values.annualSpend}
          onChange={(v) => onChange({ annualSpend: v })}
          ariaLabel="Annual spend"
          ariaValueText={`$${Math.round(values.annualSpend).toLocaleString()} per year`}
        />
        <Lever
          label="Withdrawal rate"
          primary={`${values.swrPercent}%`}
          secondary="of savings per year"
          min={2}
          max={8}
          step={0.1}
          value={values.swrPercent}
          onChange={(v) => onChange({ swrPercent: Math.round(v * 10) / 10 })}
          ariaLabel="Withdrawal rate"
          ariaValueText={`${values.swrPercent}% withdrawal rate`}
        />
        <Lever
          label="Allocation"
          primary={`${stockPct}% stocks`}
          secondary={`${100 - stockPct}% bonds · ~${expectedReturn}% / yr`}
          min={0}
          max={100}
          step={1}
          value={stockPct}
          onChange={setAllocation}
          ariaLabel="Allocation (percent stocks)"
          ariaValueText={`${stockPct}% stocks, ${100 - stockPct}% bonds`}
        >
          {ALLOCATION_SNAPS.map((s) => {
            const active = stockPct === s.pct;
            return (
              <button
                key={s.pct}
                type="button"
                onClick={() => onChange({ preset: s.preset })}
                className={[
                  "absolute -translate-x-1/2 font-mono text-[9px] tracking-[0.04em] cursor-pointer transition-colors",
                  "before:absolute before:left-1/2 before:-top-[11px] before:h-1.5 before:w-px before:-translate-x-1/2 before:content-['']",
                  active
                    ? "text-gold-accent before:bg-gold-accent"
                    : "text-app-dim hover:text-app-muted before:bg-app-line",
                ].join(" ")}
                style={{ left: `calc(${s.pct / 100} * (100% - 18px) + 9px)` }}
              >
                {s.short}
              </button>
            );
          })}
        </Lever>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// LeverReadout: "FIRE age N · X yrs sooner/later", or off-track.
// ---------------------------------------------------------------------------

function LeverReadout({
  currentFireAge,
  currentNeverFi,
  baselineFireAge,
  baselineNeverFi,
}: {
  currentFireAge: number;
  currentNeverFi: boolean;
  baselineFireAge: number;
  baselineNeverFi: boolean;
}) {
  if (currentNeverFi) {
    return <p className="text-sm text-app-muted">Off track at this setting</p>;
  }

  // Only show a delta when the saved baseline is itself on-track.
  const delta = baselineNeverFi ? 0 : baselineFireAge - currentFireAge;

  return (
    <p className="flex items-baseline gap-2">
      <span className="text-[13px] text-app-muted">FIRE age</span>
      <span
        className="font-serif font-light text-[27px] leading-none text-gold-accent tabular-nums"
        style={{ fontVariationSettings: '"opsz" 36, "SOFT" 50' }}
        data-testid="lever-fire-age"
      >
        {currentFireAge}
      </span>
      {delta > 0 && (
        <span className="text-[13px] text-app-green">
          · {delta} yr{delta > 1 ? "s" : ""} sooner
        </span>
      )}
      {delta < 0 && (
        <span className="text-[13px] text-app-red">
          · {-delta} yr{-delta > 1 ? "s" : ""} later
        </span>
      )}
    </p>
  );
}
