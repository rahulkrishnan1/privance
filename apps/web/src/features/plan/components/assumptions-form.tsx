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
// Field: label above, underline input, optional $ prefix / % suffix (mock style)
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
  suffix?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] text-app-muted">
        {label}
      </label>
      <div className="flex items-baseline border-b border-app-line pb-[7px] transition-colors focus-within:border-gold-accent">
        {prefix !== undefined && <span className="mr-1.5 text-[15px] text-app-dim">{prefix}</span>}
        {children(id)}
        {suffix !== undefined && <span className="ml-1.5 text-[13px] text-app-dim">{suffix}</span>}
      </div>
      {error !== undefined && (
        <p className="mt-1.5 text-[13px] text-app-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT_CLASS =
  "w-full flex-1 border-0 bg-transparent p-0 text-[17px] tabular-nums text-app-text outline-none placeholder:text-app-dim";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-app-line-soft py-5 last:border-b-0">
      <p className="mb-4 font-mono text-[10px] tracking-[0.2em] uppercase text-app-dim">{label}</p>
      {children}
    </div>
  );
}

// A numeric input that edits as free text (so delete-to-empty and decimals work
// smoothly, unlike a controlled type=number which clobbers mid-entry), parsing
// to the form's number on the fly and normalising the display on blur. Only
// digits and a single dot are accepted as keystrokes.
function NumberInput({
  id,
  value,
  onValueChange,
  onBlur,
  inputMode,
  placeholder,
}: {
  id: string;
  value: number | undefined;
  onValueChange: (n: number | undefined) => void;
  onBlur: () => void;
  inputMode: "numeric" | "decimal";
  placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  return (
    <input
      id={id}
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      placeholder={placeholder}
      className={INPUT_CLASS}
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
}: {
  control: Control<PlanFormValues>;
  name: NumericFieldName;
  label: string;
  prefix?: string;
  suffix?: string;
  inputMode?: "numeric" | "decimal";
  placeholder?: string;
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
            />
          )}
        </Field>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// StrategySlider: one allocation knob; return + volatility derive from history
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
    <div>
      <p className="text-[17px] font-medium text-app-text">
        {stockPct}% stocks
        <span className="ml-3 text-app-muted">{100 - stockPct}% bonds</span>
      </p>
      <p className="mt-1.5 text-[12.5px] text-app-dim">~{expectedReturn}% / year expected return</p>
      <input
        type="range"
        className="plan-range mt-3.5 w-full"
        min={0}
        max={100}
        step={1}
        value={stockPct}
        style={fillStyle(stockPct)}
        onChange={(e) => onAllocation(Number(e.target.value))}
        aria-label="Stock allocation percent"
        aria-valuetext={`${stockPct}% stocks, ${100 - stockPct}% bonds`}
      />
      <div className="relative mt-3.5 h-4">
        {ALLOCATION_SNAPS.map((s) => {
          const active = stockPct === s.pct;
          return (
            <button
              key={s.pct}
              type="button"
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
              {s.label}
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

  // Dragging the strategy slider stores a derived mu/sigma alongside the chosen
  // allocation (preset=custom), so the sim wiring is unchanged; snapping picks a
  // named preset.
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
      <Group label="You">
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
          <NumberField
            control={control}
            name="currentAge"
            label="Current age"
            inputMode="numeric"
          />
          <NumberField
            control={control}
            name="planUntilAge"
            label="Plan until age"
            inputMode="numeric"
          />
        </div>
      </Group>

      <Group label="Saving">
        <NumberField
          control={control}
          name="monthlyContribution"
          label="Monthly contribution"
          prefix="$"
          placeholder="0"
        />
      </Group>

      <Group label="Spending">
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2">
          <NumberField
            control={control}
            name="annualSpend"
            label="Annual retirement spend"
            prefix="$"
            placeholder="40000"
          />
          <div>
            <NumberField
              control={control}
              name="swrPercent"
              label="Safe withdrawal rate"
              suffix="%"
              placeholder="4"
            />
            {swrWarn !== null && errors.swrPercent === undefined && (
              <p className="mt-1.5 text-[13px] text-amber-500" role="alert">
                {swrWarn}
              </p>
            )}
          </div>
        </div>
      </Group>

      <Group label="Strategy">
        <StrategySlider stockPct={stockPct} onAllocation={applyAllocation} onSnap={applySnap} />
      </Group>

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
        className="mt-5 w-full"
      >
        {saving ? "Saving…" : "Save plan"}
      </Button>
    </form>
  );
}
