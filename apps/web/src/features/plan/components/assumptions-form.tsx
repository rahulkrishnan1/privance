"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { PresetId } from "@privance/core/projection";
import { deriveAllocationParams } from "@privance/core/projection";
import { useEffect, useId, useRef, useState } from "react";
import { type Control, Controller, useForm } from "react-hook-form";
import { Button } from "@/components/index";
import {
  ALLOCATION_SNAPS,
  type PlanFormValues,
  planFormSchema,
  resolveStockPct,
  swrWarning,
} from "../types";

const PRESET_LABELS: Record<PresetId, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

/** Display label for any preset, including "custom". Shared with the collapsed bar. */
export function presetLabel(preset: PlanFormValues["preset"]): string {
  return preset === "custom" ? "Custom" : PRESET_LABELS[preset];
}

// ---------------------------------------------------------------------------
// Field: mono-uppercase label above an underline input, optional $ prefix / suffix
// ---------------------------------------------------------------------------

function Field({
  label,
  prefix,
  suffix,
  error,
  children,
}: {
  label: string;
  prefix?: string;
  suffix?: React.ReactNode;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-[9px]">
      <label
        htmlFor={id}
        className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-app-dim"
      >
        {label}
      </label>
      <div className="flex items-baseline border-b border-app-line pb-2 transition-colors focus-within:border-gold-accent">
        {prefix !== undefined && <span className="mr-1 text-[14px] text-app-dim">{prefix}</span>}
        {children(id)}
        {suffix !== undefined && (
          <span className="ml-[5px] whitespace-nowrap text-[13px] text-app-dim">{suffix}</span>
        )}
      </div>
      {error !== undefined && (
        <p className="mt-1.5 text-[13px] text-app-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT_BASE =
  "min-w-0 border-0 bg-transparent p-0 text-[19px] font-medium tabular-nums text-app-text outline-none placeholder:text-app-dim";

// Numeric input that edits as free text so delete-to-empty and decimals work
// (a controlled type=number clobbers mid-entry). Parses to a number on change,
// normalises the display on blur; accepts only digits and a single dot. When
// `autosize` is set it sizes to its content (native field-sizing) so a trailing
// suffix sits snug against the number instead of being pushed to the cell edge.
function NumberInput({
  id,
  value,
  onValueChange,
  onBlur,
  inputMode,
  placeholder,
  autosize = false,
}: {
  id: string;
  value: number | undefined;
  onValueChange: (n: number | undefined) => void;
  onBlur: () => void;
  inputMode: "numeric" | "decimal";
  placeholder?: string;
  autosize?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  return (
    <input
      id={id}
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      placeholder={placeholder}
      size={autosize ? 4 : undefined}
      className={autosize ? `${INPUT_BASE} field-sizing-content` : `${INPUT_BASE} w-full flex-1`}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^\d*\.?\d*$/.test(raw)) return; // digits + at most one dot
        setText(raw);
        const n = raw === "" || raw === "." ? undefined : Number(raw);
        onValueChange(n !== undefined && Number.isNaN(n) ? undefined : n);
      }}
      onBlur={() => {
        // Normalise the display to the canonical number ("3." -> "3", "02" -> "2").
        setText(value === undefined ? "" : String(value));
        onBlur();
      }}
    />
  );
}

type NumericFieldName =
  | "currentAge"
  | "planUntilAge"
  | "monthlyContribution"
  | "annualSpend"
  | "swrPercent";

function NumberField({
  control,
  name,
  label,
  prefix,
  suffix,
  inputMode = "decimal",
  placeholder,
  autosize,
}: {
  control: Control<PlanFormValues>;
  name: NumericFieldName;
  label: string;
  prefix?: string;
  suffix?: React.ReactNode;
  inputMode?: "numeric" | "decimal";
  placeholder?: string;
  autosize?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} prefix={prefix} suffix={suffix} error={fieldState.error?.message}>
          {(id) => (
            <NumberInput
              id={id}
              value={field.value as number | undefined}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              inputMode={inputMode}
              placeholder={placeholder}
              autosize={autosize}
            />
          )}
        </Field>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// AllocationField: editable stock-allocation cell, two-way synced with the slider
// ---------------------------------------------------------------------------

function AllocationField({
  stockPct,
  onAllocation,
}: {
  stockPct: number;
  onAllocation: (pct: number) => void;
}) {
  // Local text buffer (same reason as NumberInput): binding the input straight to
  // the derived stockPct would snap the caret to the end on every keystroke and
  // make the cell impossible to clear. The slider and snap presets drive stockPct,
  // so sync the buffer back from it; blur normalises a transient/empty edit.
  const [text, setText] = useState(String(stockPct));
  useEffect(() => setText(String(stockPct)), [stockPct]);
  return (
    <Field
      label="Stock allocation"
      suffix={
        <>
          % stocks <span className="text-app-muted">&middot; {100 - stockPct}% bonds</span>
        </>
      }
    >
      {(id) => (
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          size={4}
          className={`${INPUT_BASE} field-sizing-content`}
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, "");
            setText(raw);
            // Empty is a transient edit state, not 0; blur restores the committed value.
            if (raw !== "") onAllocation(Math.max(0, Math.min(100, Number(raw))));
          }}
          onBlur={() => setText(String(stockPct))}
        />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// StrategySlider: expected-return caption + allocation slider + snap presets.
// The allocation number lives in the grid (AllocationField); this is the knob.
// ---------------------------------------------------------------------------

function fillStyle(pct: number): React.CSSProperties {
  const p = Math.min(100, Math.max(0, pct));
  return {
    backgroundImage: `linear-gradient(90deg, var(--color-gold-accent) ${p}%, rgba(255,255,255,0.10) ${p}%)`,
  };
}

function StrategySlider({
  stockPct,
  onAllocation,
  onSnap,
}: {
  stockPct: number;
  onAllocation: (pct: number) => void;
  onSnap: (preset: PresetId) => void;
}) {
  const expectedReturn = (deriveAllocationParams(stockPct / 100).muBps / 100).toFixed(1);
  return (
    <div className="mt-6">
      <p className="text-[13px] text-app-muted">~{expectedReturn}% / year expected return</p>
      <input
        type="range"
        className="plan-range mt-4 w-full"
        min={0}
        max={100}
        step={1}
        value={stockPct}
        style={fillStyle(stockPct)}
        onChange={(e) => onAllocation(Number(e.target.value))}
        aria-label="Stock allocation percent"
        aria-valuetext={`${stockPct}% stocks, ${100 - stockPct}% bonds`}
      />
      <div className="relative mt-4 h-4">
        {ALLOCATION_SNAPS.map((s) => {
          const active = stockPct === s.pct;
          return (
            <button
              key={s.pct}
              type="button"
              aria-label={s.label}
              onClick={() => onSnap(s.preset)}
              className={[
                "absolute -translate-x-1/2 font-mono text-[9.5px] cursor-pointer transition-colors",
                "before:absolute before:left-1/2 before:-top-[11px] before:h-1.5 before:w-px before:-translate-x-1/2 before:content-['']",
                active
                  ? "text-gold-accent before:bg-gold-accent"
                  : "text-app-dim hover:text-app-muted before:bg-app-line",
              ].join(" ")}
              style={{ left: `calc(${s.pct / 100} * (100% - 18px) + 9px)` }}
            >
              <span className="md:hidden">{s.short}</span>
              <span className="hidden md:inline">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssumptionsForm
// ---------------------------------------------------------------------------

export type AssumptionsFormProps = {
  defaultValues: Partial<PlanFormValues>;
  /** Called when the form changes and passes validation (debounced upstream). */
  onChange: (values: PlanFormValues) => void;
  onSave: (values: PlanFormValues) => Promise<void>;
  saving?: boolean;
  /** When true, the Save button is disabled (e.g. the loaded record is unreadable). */
  saveDisabled?: boolean;
};

export function AssumptionsForm({
  defaultValues,
  onChange,
  onSave,
  saving = false,
  saveDisabled = false,
}: AssumptionsFormProps) {
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: {
      currentAge: defaultValues.currentAge,
      planUntilAge: defaultValues.planUntilAge ?? 95,
      monthlyContribution: defaultValues.monthlyContribution ?? 0,
      annualSpend: defaultValues.annualSpend,
      swrPercent: defaultValues.swrPercent ?? 4,
      preset: defaultValues.preset ?? "balanced",
      muPercent: defaultValues.muPercent,
      sigmaPercent: defaultValues.sigmaPercent,
      stockWeightPercent: defaultValues.stockWeightPercent,
    },
    // Validate when a field is left, not on every keystroke: clearing a field
    // to retype a number must not flash "invalid" mid-edit. The live preview is
    // driven by the separate watch effect below, so it stays responsive.
    mode: "onBlur",
  });

  const watchedValues = watch();
  const swrPercent = watch("swrPercent");
  const swrWarn = typeof swrPercent === "number" ? swrWarning(swrPercent) : null;
  const stockPct = resolveStockPct(watchedValues);

  // Dragging the strategy slider (or typing in the allocation cell) stores a
  // derived mu/sigma alongside the chosen allocation (preset=custom), so the sim
  // wiring is unchanged; snapping picks a named preset.
  const applyAllocation = (pct: number) => {
    const params = deriveAllocationParams(pct / 100);
    setValue("preset", "custom", { shouldValidate: true });
    setValue("stockWeightPercent", pct, { shouldValidate: true });
    setValue("muPercent", params.muBps / 100, { shouldValidate: true });
    setValue("sigmaPercent", params.sigmaBps / 100, { shouldValidate: true });
  };
  const applySnap = (p: PresetId) => {
    setValue("preset", p, { shouldValidate: true });
  };

  // Stable ref so the effect closure never re-fires just because onChange prop identity changed.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Notify parent whenever the form values change and pass validation.
  useEffect(() => {
    const parsed = planFormSchema.safeParse(watchedValues);
    if (parsed.success) {
      onChangeRef.current(parsed.data);
    }
  }, [watchedValues]);

  const submit = handleSubmit(async (values) => {
    setSaveError(null);
    try {
      await onSave(values);
    } catch {
      setSaveError("Could not save. Please try again.");
    }
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      className="flex flex-col"
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <NumberField control={control} name="currentAge" label="Current age" inputMode="numeric" />
        <NumberField
          control={control}
          name="planUntilAge"
          label="Plan until age"
          inputMode="numeric"
        />
        <NumberField
          control={control}
          name="monthlyContribution"
          label="Monthly contribution"
          prefix="$"
          placeholder="0"
        />
        <NumberField
          control={control}
          name="annualSpend"
          label="Target annual spend"
          prefix="$"
          placeholder="40000"
        />
        <div>
          <NumberField
            control={control}
            name="swrPercent"
            label="Withdrawal rate"
            suffix="%"
            placeholder="4"
            autosize
          />
          {swrWarn !== null && errors.swrPercent === undefined && (
            <p className="mt-1.5 text-[13px] text-amber-500" role="alert">
              {swrWarn}
            </p>
          )}
        </div>
        <AllocationField stockPct={stockPct} onAllocation={applyAllocation} />
      </div>

      <StrategySlider stockPct={stockPct} onAllocation={applyAllocation} onSnap={applySnap} />

      {saveError !== null && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-app-red/40 bg-app-red/10 px-4 py-3"
        >
          <p className="text-[13px] text-app-red">{saveError}</p>
        </div>
      )}

      <Button
        type="submit"
        loading={saving}
        disabled={saving || saveDisabled}
        className="mt-6 w-full"
      >
        {saving ? "Saving…" : "Save plan"}
      </Button>
    </form>
  );
}
