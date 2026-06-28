"use client";

import type { Decimal } from "@privance/core";
import { deriveAllocationParams } from "@privance/core/projection";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ALLOCATION_SNAPS, type PlanFormValues, resolveStockPct, swrWarning } from "../types";

type AdjustPanelProps = {
  values: PlanFormValues;
  /** Account-derived pot (null while loading or no accounts). */
  potCents: Decimal | null;
  /** Saved-plan baseline; slider ranges scale to it so values sit mid-track. */
  baseline: PlanFormValues;
  /** Current median FIRE age; the readout shows it and its delta vs the saved plan. */
  currentFireAge: number;
  currentNeverFi: boolean;
  /** Saved-plan FIRE age; anchors the sooner/later delta. */
  baselineFireAge: number;
  baselineNeverFi: boolean;
  dirty: boolean;
  saving: boolean;
  /** The last save failed; show a retry prompt next to the Save button. */
  saveError?: boolean;
  saveDisabled?: boolean;
  onChange: (patch: Partial<PlanFormValues>) => void;
  onSave: () => void;
};

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function fillStyle(value: number, min: number, max: number): React.CSSProperties {
  const pct = max <= min ? 0 : ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return {
    backgroundImage: `linear-gradient(90deg, var(--color-accent) ${pct}%, rgba(235,235,230,0.10) ${pct}%)`,
  };
}

const dollars = (n: number) => `$${Math.round(n).toLocaleString()}`;

function FactInput({
  label,
  value,
  onCommit,
  inputMode = "numeric",
  disabled = false,
  format,
  className,
  veil = false,
  children,
}: {
  label: string;
  value: number | undefined;
  onCommit: (n: number | undefined) => void;
  inputMode?: "numeric" | "decimal";
  disabled?: boolean;
  /** Display formatter for the committed value (e.g. currency). */
  format?: (n: number) => string;
  className?: string;
  /** Frost the value under the Veil (money figures only). */
  veil?: boolean;
  children?: React.ReactNode;
}) {
  const id = useId();
  const display = value === undefined ? "" : format ? format(value) : String(value);
  const [text, setText] = useState(display);
  const focusedRef = useRef(false);
  // Re-sync from the committed value when it changes externally (e.g. switching
  // the starting source prefills the manual amount), but never mid-edit: while
  // the field is focused the typed text is authoritative, or a clamp/reformat of
  // the committed value would overwrite the user's in-progress keystrokes.
  useEffect(() => {
    if (focusedRef.current) return;
    setText(value === undefined ? "" : format ? format(value) : String(value));
  }, [value, format]);

  return (
    <div className={["flex flex-col", className].filter(Boolean).join(" ")}>
      <label
        htmlFor={id}
        className="mb-[7px] font-mono text-xs uppercase tracking-label text-faint"
      >
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          disabled={disabled}
          value={text}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const cleaned = raw.replace(/[^0-9.]/g, "");
            const n = cleaned === "" || cleaned === "." ? undefined : Number(cleaned);
            onCommit(n !== undefined && Number.isNaN(n) ? undefined : n);
          }}
          onBlur={() => {
            focusedRef.current = false;
            setText(value === undefined ? "" : format ? format(value) : String(value));
          }}
          className={`min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 py-[11px] font-mono text-base text-cream outline-none transition-colors focus:border-accent-dim disabled:text-cream-soft${veil ? " vfig" : ""}`}
        />
        {children}
      </div>
    </div>
  );
}

function Lever({
  name,
  readout,
  veiled = true,
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
  ariaValueText,
  impact,
  warn,
  children,
}: {
  name: string;
  readout: string;
  veiled?: boolean;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  ariaValueText: string;
  impact?: React.ReactNode;
  warn?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line-soft py-4 last:border-b-0 last:pb-0">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-cream">{name}</span>
        <span className={`font-mono text-sm tabular-nums text-accent${veiled ? " vfig" : ""}`}>
          {readout}
        </span>
      </div>
      <input
        type="range"
        className="plan-range mt-3 w-full"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        style={fillStyle(value, min, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
      />
      {children}
      {impact !== undefined && <p className="mt-2.5 font-mono text-xs text-faint">{impact}</p>}
      {warn != null && (
        <p className="mt-1.5 font-mono text-xs text-signal" role="alert">
          {warn}
        </p>
      )}
    </div>
  );
}

function FiReadout({
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
  const capsule =
    "inline-flex items-baseline gap-2 rounded-full border border-line px-3 py-[5px] font-mono text-xs tabular-nums";
  if (currentNeverFi) {
    return <span className={`${capsule} text-faint`}>Off track at this setting</span>;
  }
  // No delta when the saved plan itself never reaches FI; there's nothing to
  // measure sooner/later against.
  const delta = baselineNeverFi ? 0 : baselineFireAge - currentFireAge;
  return (
    <span className={capsule}>
      <span className="text-xs uppercase tracking-label text-faint">FI age</span>
      <span className="text-sm font-medium text-accent">{currentFireAge}</span>
      {delta > 0 && (
        <span className="text-up">
          {delta} yr{delta > 1 ? "s" : ""} sooner
        </span>
      )}
      {delta < 0 && (
        <span className="text-down">
          {-delta} yr{-delta > 1 ? "s" : ""} later
        </span>
      )}
    </span>
  );
}

export function AdjustPanel({
  values,
  potCents,
  baseline,
  currentFireAge,
  currentNeverFi,
  baselineFireAge,
  baselineNeverFi,
  dirty,
  saving,
  saveError = false,
  saveDisabled = false,
  onChange,
  onSave,
}: AdjustPanelProps) {
  const manual = values.manualStartingDollars !== undefined;
  const accountDollars = potCents !== null ? potCents.toFloat() : 0;

  const monthly = values.monthlyContribution ?? 0;
  const baseMonthly = baseline.monthlyContribution ?? 0;
  // Ranges scale to the saved plan but keep generous floors, so a fresh default
  // plan can still reach realistic contributions/spend without saving once just
  // to widen the slider. spendMin is capped at the baseline so a low saved spend
  // stays representable.
  const monthlyMax = Math.max(roundTo(baseMonthly * 2.5, 500), 25000);
  const spendMin = Math.min(baseline.annualSpend, 30000);
  const spendMax = Math.max(roundTo(baseline.annualSpend * 2, 1000), 200000);
  const stockPct = resolveStockPct(values);
  const allocName = ALLOCATION_SNAPS.find((s) => s.pct === stockPct)?.label ?? "Custom";
  // Expected real return for the current mix, e.g. "5.0"; display-only.
  const expectedReturn = (deriveAllocationParams(stockPct / 100).muBps / 100).toFixed(1);

  // Dragging stores the derived mu/sigma alongside the chosen weight (preset
  // custom), so the sim wiring is unchanged; the snap buttons pick a named preset.
  const setAllocationPct = (pct: number) => {
    const params = deriveAllocationParams(pct / 100);
    onChange({
      preset: "custom",
      stockWeightPercent: pct,
      muPercent: params.muBps / 100,
      sigmaPercent: params.sigmaBps / 100,
    });
  };

  const saveLabel = saving ? "Saving…" : dirty ? "Save plan" : "Saved";
  const canSave = dirty && !saving && !saveDisabled;

  return (
    <div className="glass rounded-[10px] p-6">
      {/* One wrapping row: on mobile the readout drops to its own full-width line
          (order-3 + w-full) clear of Save; on desktop it sits inline by the title. */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-2.5">
        <h3 className="font-serif text-2xl font-normal tracking-[-0.005em]">Adjust your plan</h3>
        <div className="order-3 w-full sm:order-2 sm:w-auto">
          <FiReadout
            currentFireAge={currentFireAge}
            currentNeverFi={currentNeverFi}
            baselineFireAge={baselineFireAge}
            baselineNeverFi={baselineNeverFi}
          />
        </div>
        <Button
          onClick={onSave}
          disabled={!canSave}
          aria-label={dirty ? "Save plan" : "Plan saved"}
          variant={dirty && !saveDisabled ? "primary" : "ghost"}
          size="sm"
          loading={saving}
          className="order-2 ml-auto self-start shrink-0 whitespace-nowrap sm:order-3"
        >
          {saveLabel}
        </Button>
      </div>

      {saveError && (
        <p role="alert" className="mb-4 font-mono text-xs text-signal">
          Could not save your plan. Check your connection and try again.
        </p>
      )}

      {/* Facts */}
      <div className="grid grid-cols-2 gap-4 border-b border-line-soft pb-[22px] max-[430px]:grid-cols-1">
        <FactInput
          label="Current age"
          value={values.currentAge}
          // Clamp to the schema's age bounds (and below plan-until) so an
          // unreadable plan can't be saved.
          onCommit={(n) =>
            n !== undefined &&
            onChange({
              currentAge: clamp(Math.round(n), 16, Math.min(100, values.planUntilAge - 1)),
            })
          }
        />
        <FactInput
          label="Plan until age"
          value={values.planUntilAge}
          onCommit={(n) =>
            n !== undefined &&
            onChange({ planUntilAge: clamp(Math.round(n), values.currentAge + 1, 110) })
          }
        />
        <FactInput
          label="Starting portfolio"
          value={manual ? values.manualStartingDollars : accountDollars}
          disabled={!manual}
          inputMode="decimal"
          format={dollars}
          veil
          onCommit={(n) => manual && onChange({ manualStartingDollars: n ?? 0 })}
          // Own full-width row so the source toggle sits on the same line as the
          // input rather than under it.
          className="col-span-2 max-[430px]:col-span-1"
        >
          <ToggleGroup
            type="single"
            value={manual ? "manual" : "accounts"}
            onValueChange={(nv) => {
              if (!nv) return;
              const toManual = nv === "manual";
              if (toManual === manual) return;
              onChange({
                manualStartingDollars: toManual ? Math.round(accountDollars) : undefined,
              });
            }}
            aria-label="Starting portfolio source"
            className="shrink-0 rounded-lg border border-line bg-panel p-[3px] gap-0.5"
          >
            <ToggleGroupItem value="accounts" size="sm">
              Accounts
            </ToggleGroupItem>
            <ToggleGroupItem value="manual" size="sm">
              Manual
            </ToggleGroupItem>
          </ToggleGroup>
        </FactInput>
      </div>

      {/* Levers */}
      <Lever
        name="Monthly contribution"
        readout={dollars(monthly)}
        min={0}
        max={monthlyMax}
        step={100}
        value={monthly}
        onChange={(v) => onChange({ monthlyContribution: v })}
        ariaLabel="Monthly contribution"
        ariaValueText={`${dollars(monthly)} per month`}
      />
      <Lever
        name="Target annual spend"
        readout={dollars(values.annualSpend)}
        min={spendMin}
        max={spendMax}
        step={1000}
        value={values.annualSpend}
        onChange={(v) => onChange({ annualSpend: v })}
        ariaLabel="Target annual spend"
        ariaValueText={`${dollars(values.annualSpend)} per year`}
      />
      <Lever
        name="Withdrawal rate"
        readout={`${values.swrPercent}%`}
        veiled={false}
        min={2}
        max={8}
        step={0.1}
        value={values.swrPercent}
        onChange={(v) => onChange({ swrPercent: Math.round(v * 10) / 10 })}
        ariaLabel="Withdrawal rate"
        ariaValueText={`${values.swrPercent}% withdrawal rate`}
        warn={swrWarning(values.swrPercent)}
      />
      <Lever
        name="Stock allocation"
        readout={`${allocName} · ${stockPct}/${100 - stockPct}`}
        veiled={false}
        min={0}
        max={100}
        step={1}
        value={stockPct}
        onChange={setAllocationPct}
        ariaLabel="Stock allocation (percent stocks)"
        ariaValueText={`${stockPct}% stocks, ${100 - stockPct}% bonds`}
        impact={
          <>~{expectedReturn}% / yr expected real return · return and volatility follow the mix</>
        }
      >
        {/* Filter-pill pattern: rounded-full tinted active, not the filled segmented-control style from segmentItemVariants. */}
        <ToggleGroup
          type="single"
          value={ALLOCATION_SNAPS.find((s) => s.pct === stockPct)?.preset ?? ""}
          onValueChange={(nv) => {
            if (!nv) return;
            const snap = ALLOCATION_SNAPS.find((s) => s.preset === nv);
            if (snap) onChange({ preset: snap.preset });
          }}
          aria-label="Allocation preset"
          className="mt-3 gap-2"
        >
          {ALLOCATION_SNAPS.map((s) => (
            <ToggleGroupItem
              key={s.pct}
              value={s.preset}
              size="sm"
              className="rounded-full border border-line px-3 py-1 data-[state=on]:border-accent data-[state=on]:bg-accent/10 data-[state=on]:text-accent"
            >
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Lever>
    </div>
  );
}
