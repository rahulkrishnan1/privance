import { expect, test } from "vitest";
import {
  isNeverFiState,
  type PlanFormValues,
  planFormSchema,
  resolveStockPct,
  resolveStockPctOrNull,
  samePlanValues,
  swrWarning,
} from "./types";

const valid = {
  currentAge: 30,
  planUntilAge: 65,
  monthlyContribution: 500,
  annualSpend: 40000,
  swrPercent: 4,
  preset: "balanced" as const,
};

test("rejects currentAge below 16", () => {
  const result = planFormSchema.safeParse({ ...valid, currentAge: 15 });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("currentAge");
  }
});

test("accepts currentAge of 16", () => {
  const result = planFormSchema.safeParse({ ...valid, currentAge: 16 });
  expect(result.success).toBe(true);
});

test("rejects planUntilAge equal to currentAge", () => {
  const result = planFormSchema.safeParse({ ...valid, currentAge: 30, planUntilAge: 30 });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("planUntilAge");
  }
});

test("rejects planUntilAge less than currentAge", () => {
  const result = planFormSchema.safeParse({ ...valid, currentAge: 30, planUntilAge: 29 });
  expect(result.success).toBe(false);
});

test("accepts SWR of 8% (above warn threshold but within max)", () => {
  const result = planFormSchema.safeParse({ ...valid, swrPercent: 8 });
  expect(result.success).toBe(true);
});

test("rejects SWR of 12% (above 10% max)", () => {
  const result = planFormSchema.safeParse({ ...valid, swrPercent: 12 });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("swrPercent");
  }
});

test("rejects SWR of 0.4% (below 0.5% min)", () => {
  const result = planFormSchema.safeParse({ ...valid, swrPercent: 0.4 });
  expect(result.success).toBe(false);
});

test("custom preset without overrides is rejected", () => {
  const result = planFormSchema.safeParse({ ...valid, preset: "custom" });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths.length).toBeGreaterThan(0);
  }
});

test("custom preset with all three overrides is accepted", () => {
  const result = planFormSchema.safeParse({
    ...valid,
    preset: "custom",
    muPercent: 7,
    sigmaPercent: 12,
    stockWeightPercent: 60,
  });
  expect(result.success).toBe(true);
});

test("custom preset with out-of-range mu is rejected", () => {
  const result = planFormSchema.safeParse({
    ...valid,
    preset: "custom",
    muPercent: 20,
    sigmaPercent: 12,
    stockWeightPercent: 60,
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("muPercent");
  }
});

test("zero monthly contribution is accepted", () => {
  const result = planFormSchema.safeParse({ ...valid, monthlyContribution: 0 });
  expect(result.success).toBe(true);
});

test("negative monthly contribution is rejected", () => {
  const result = planFormSchema.safeParse({ ...valid, monthlyContribution: -100 });
  expect(result.success).toBe(false);
});

test("swrWarning flags an SWR below 2% as conservative", () => {
  expect(swrWarning(1)).toMatch(/below 2%/);
});

test("swrWarning flags an SWR above 6% as aggressive", () => {
  expect(swrWarning(8)).toMatch(/above 6%/);
});

test("swrWarning returns null for an SWR inside the 2%-6% band", () => {
  expect(swrWarning(4)).toBeNull();
});

test("swrWarning band edges (2% and 6%) are not warned", () => {
  expect(swrWarning(2)).toBeNull();
  expect(swrWarning(6)).toBeNull();
  // Just outside the band does warn.
  expect(swrWarning(1.99)).toMatch(/below 2%/);
  expect(swrWarning(6.01)).toMatch(/above 6%/);
});

test("isNeverFiState is true only when the median is pinned at planUntilAge and most paths never reach FI", () => {
  expect(isNeverFiState(95, 95, 0.5)).toBe(true);
  expect(isNeverFiState(95, 95, 0.8)).toBe(true);
});

test("isNeverFiState is false when the median reaches FI before planUntilAge", () => {
  // A real FI age, even with a high never-FI fraction, is not the sentinel.
  expect(isNeverFiState(60, 95, 0.9)).toBe(false);
});

test("isNeverFiState is false at the fraction boundary just below half", () => {
  expect(isNeverFiState(95, 95, 0.49)).toBe(false);
  // Exactly half is the inclusive boundary.
  expect(isNeverFiState(95, 95, 0.5)).toBe(true);
});

test("resolveStockPct returns the named preset's stock weight", () => {
  expect(resolveStockPct({ ...valid, preset: "conservative" })).toBe(30);
  expect(resolveStockPct({ ...valid, preset: "balanced" })).toBe(60);
  expect(resolveStockPct({ ...valid, preset: "aggressive" })).toBe(90);
});

test("resolveStockPct returns the explicit weight for custom mode", () => {
  expect(
    resolveStockPct({
      ...valid,
      preset: "custom",
      muPercent: 7,
      sigmaPercent: 12,
      stockWeightPercent: 72,
    }),
  ).toBe(72);
});

test("resolveStockPctOrNull is null for custom mode with no explicit weight", () => {
  expect(
    resolveStockPctOrNull({ ...valid, preset: "custom", muPercent: 7, sigmaPercent: 12 }),
  ).toBeNull();
});

test("resolveStockPct defaults to 60 for custom mode with no explicit weight", () => {
  expect(resolveStockPct({ ...valid, preset: "custom", muPercent: 7, sigmaPercent: 12 })).toBe(60);
});

const baseValues: PlanFormValues = {
  currentAge: 30,
  planUntilAge: 65,
  monthlyContribution: 500,
  annualSpend: 40000,
  swrPercent: 4,
  preset: "balanced",
};

test("samePlanValues is true for two distinct objects with equal fields", () => {
  expect(samePlanValues({ ...baseValues }, { ...baseValues })).toBe(true);
});

test("samePlanValues is false when any compared field differs", () => {
  expect(samePlanValues(baseValues, { ...baseValues, currentAge: 31 })).toBe(false);
  expect(samePlanValues(baseValues, { ...baseValues, annualSpend: 41000 })).toBe(false);
  expect(samePlanValues(baseValues, { ...baseValues, preset: "aggressive" })).toBe(false);
  expect(samePlanValues(baseValues, { ...baseValues, swrPercent: 3.5 })).toBe(false);
});
