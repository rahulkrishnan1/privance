import { Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test } from "vitest";
import { formatCurrencyWhole, formatPercentWhole } from "./format";

function toCents(dollars: number): Decimal {
  return Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS);
}

// ---------------------------------------------------------------------------
// formatPercentWhole
// ---------------------------------------------------------------------------

test("formatPercentWhole: 0.885 rounds to 89%", () => {
  expect(formatPercentWhole(0.885)).toBe("89%");
});

test("formatPercentWhole: 0.0014 returns <1%", () => {
  expect(formatPercentWhole(0.0014)).toBe("<1%");
});

test("formatPercentWhole: 0.9986 returns >99%", () => {
  expect(formatPercentWhole(0.9986)).toBe(">99%");
});

test("formatPercentWhole: 0 returns 0%", () => {
  expect(formatPercentWhole(0)).toBe("0%");
});

test("formatPercentWhole: 1 returns 100%", () => {
  expect(formatPercentWhole(1)).toBe("100%");
});

// ---------------------------------------------------------------------------
// formatCurrencyWhole
// ---------------------------------------------------------------------------

test("formatCurrencyWhole: 1000000 returns $1,000,000", () => {
  expect(formatCurrencyWhole(toCents(1_000_000))).toBe("$1,000,000");
});
