import { PRESETS, type PresetId } from "@privance/core/projection";
import { z } from "zod";

/** Minimum age allowed as currentAge. */
const AGE_MIN = 16;
/** Maximum allowed currentAge. */
const AGE_MAX = 100;
/** Maximum allowed planUntilAge. */
const PLAN_UNTIL_AGE_MAX = 110;

/** SWR bounds in basis points. */
const SWR_BPS_MIN = 50;
const SWR_BPS_MAX = 1000;

/** Non-blocking warning band: outside 2%-6% SWR (200-600 bps). */
const SWR_WARN_LOW_BPS = 200;
const SWR_WARN_HIGH_BPS = 600;

/** Custom override bounds in basis points. */
const MU_BPS_MIN = -500;
const MU_BPS_MAX = 1500;
const SIGMA_BPS_MIN = 100;
const SIGMA_BPS_MAX = 4000;
const STOCK_WEIGHT_BPS_MIN = 0;
const STOCK_WEIGHT_BPS_MAX = 10000;

export const planFormSchema = z
  .object({
    currentAge: z
      .number()
      .int("Age must be a whole number")
      .min(AGE_MIN, `Age must be at least ${AGE_MIN}`)
      .max(AGE_MAX, `Age must be at most ${AGE_MAX}`),
    planUntilAge: z
      .number()
      .int("Plan-until age must be a whole number")
      .max(PLAN_UNTIL_AGE_MAX, `Plan-until age must be at most ${PLAN_UNTIL_AGE_MAX}`),
    monthlyContribution: z.number().min(0, "Monthly contribution cannot be negative"),
    annualSpend: z.number().positive("Annual spend must be greater than 0"),
    swrPercent: z
      .number()
      .min(SWR_BPS_MIN / 100, `SWR must be at least ${SWR_BPS_MIN / 100}%`)
      .max(SWR_BPS_MAX / 100, `SWR must be at most ${SWR_BPS_MAX / 100}%`),
    preset: z.enum(["conservative", "balanced", "aggressive", "custom"]),
    muPercent: z.number().optional(),
    sigmaPercent: z.number().optional(),
    stockWeightPercent: z.number().optional(),
    // Manual starting portfolio in dollars. undefined = derive from accounts.
    manualStartingDollars: z.number().nonnegative().optional(),
  })
  .refine((v) => v.planUntilAge > v.currentAge, {
    message: "Plan-until age must be greater than current age",
    path: ["planUntilAge"],
  })
  .refine(
    (v) => {
      if (v.preset !== "custom") return true;
      return v.muPercent !== undefined;
    },
    { message: "Expected return is required for custom mode", path: ["muPercent"] },
  )
  .refine(
    (v) => {
      if (v.preset !== "custom") return true;
      return v.sigmaPercent !== undefined;
    },
    { message: "Volatility is required for custom mode", path: ["sigmaPercent"] },
  )
  .refine(
    (v) => {
      if (v.preset !== "custom") return true;
      return v.stockWeightPercent !== undefined;
    },
    { message: "Stock weight is required for custom mode", path: ["stockWeightPercent"] },
  )
  .refine(
    (v) => {
      if (v.preset !== "custom" || v.muPercent === undefined) return true;
      const bps = Math.round(v.muPercent * 100);
      return bps >= MU_BPS_MIN && bps <= MU_BPS_MAX;
    },
    {
      message: `Expected return must be between ${MU_BPS_MIN / 100}% and ${MU_BPS_MAX / 100}%`,
      path: ["muPercent"],
    },
  )
  .refine(
    (v) => {
      if (v.preset !== "custom" || v.sigmaPercent === undefined) return true;
      const bps = Math.round(v.sigmaPercent * 100);
      return bps >= SIGMA_BPS_MIN && bps <= SIGMA_BPS_MAX;
    },
    {
      message: `Volatility must be between ${SIGMA_BPS_MIN / 100}% and ${SIGMA_BPS_MAX / 100}%`,
      path: ["sigmaPercent"],
    },
  )
  .refine(
    (v) => {
      if (v.preset !== "custom" || v.stockWeightPercent === undefined) return true;
      const bps = Math.round(v.stockWeightPercent * 100);
      return bps >= STOCK_WEIGHT_BPS_MIN && bps <= STOCK_WEIGHT_BPS_MAX;
    },
    {
      message: `Stock weight must be between ${STOCK_WEIGHT_BPS_MIN / 100}% and ${STOCK_WEIGHT_BPS_MAX / 100}%`,
      path: ["stockWeightPercent"],
    },
  );

export type PlanFormValues = z.infer<typeof planFormSchema>;

const FORM_KEYS: (keyof PlanFormValues)[] = [
  "currentAge",
  "planUntilAge",
  "monthlyContribution",
  "annualSpend",
  "swrPercent",
  "preset",
  "muPercent",
  "sigmaPercent",
  "stockWeightPercent",
  "manualStartingDollars",
];

/**
 * The Adjust form re-emits onChange with a fresh object on every render; only a
 * real field change should replace the working values, or the debounced sim
 * would reset on every render and never settle.
 */
export function samePlanValues(a: PlanFormValues, b: PlanFormValues): boolean {
  return FORM_KEYS.every((k) => a[k] === b[k]);
}

/** The three allocation anchors; `label` is the full name shown on the snap buttons. */
export const ALLOCATION_SNAPS: readonly {
  pct: number;
  preset: PresetId;
  label: string;
}[] = [
  { pct: 30, preset: "conservative", label: "Cautious" },
  { pct: 60, preset: "balanced", label: "Balanced" },
  { pct: 90, preset: "aggressive", label: "Aggressive" },
];

/** Default stock allocation (balanced) used when an allocation cannot be resolved. */
const DEFAULT_STOCK_PCT = 60;

/**
 * Stock-allocation percent for these plan values, or null when it cannot be
 * resolved (custom mode with no explicit weight, or an unknown preset). The
 * collapsed summary falls back to the preset label in that case.
 */
export function resolveStockPctOrNull(values: PlanFormValues): number | null {
  if (values.preset === "custom") {
    return values.stockWeightPercent !== undefined ? Math.round(values.stockWeightPercent) : null;
  }
  const p = PRESETS.find((x) => x.id === values.preset);
  return p !== undefined ? Math.round(p.stockWeight * 100) : null;
}

/** Stock-allocation percent, defaulting to balanced (60%) when unresolved. */
export function resolveStockPct(values: PlanFormValues): number {
  return resolveStockPctOrNull(values) ?? DEFAULT_STOCK_PCT;
}

export function swrWarning(swrPercent: number): string | null {
  const bps = Math.round(swrPercent * 100);
  if (bps < SWR_WARN_LOW_BPS)
    return "SWR below 2% is very conservative; results may be pessimistic.";
  if (bps > SWR_WARN_HIGH_BPS)
    return "SWR above 6% is aggressive; historical survival rates drop sharply.";
  return null;
}

// medianFireAge === planUntilAge is the never-reached sentinel; >= 0.5 covers the boundary.
export function isNeverFiState(
  medianFireAge: number,
  planUntilAge: number,
  neverFiFraction: number,
): boolean {
  return medianFireAge === planUntilAge && neverFiFraction >= 0.5;
}
