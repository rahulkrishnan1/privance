import { Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test } from "vitest";
import { formatCurrency, formatCurrencyCompact, formatCurrencyWhole } from "./format";

function toCents(dollars: number): Decimal {
  return Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS);
}

test("formatCurrency: groups thousands and keeps two cents", () => {
  expect(formatCurrency(toCents(1_234.5))).toBe("$1,234.50");
});

test("formatCurrency: zero renders $0.00", () => {
  expect(formatCurrency(Decimal.zero(SCALE_CENTS))).toBe("$0.00");
});

test("formatCurrency: keeps the minus sign on negative balances", () => {
  expect(formatCurrency(toCents(-42.75))).toBe("-$42.75");
});

test("formatCurrency: sub-dollar amount shows leading zero dollars", () => {
  expect(formatCurrency(toCents(0.07))).toBe("$0.07");
});

test("formatCurrency: respects a non-default currency code", () => {
  // Symbol differs from USD; the point is the currency arg is honored.
  expect(formatCurrency(toCents(1_000), "EUR")).toContain("1,000.00");
  expect(formatCurrency(toCents(1_000), "EUR")).not.toContain("$");
});

test("formatCurrency: near 2^53 minor units still renders without overflow garble", () => {
  // ~$90 trillion at cent precision is the documented upper bound; below it the
  // Number coercion stays exact enough for a grouped display string.
  const big = Decimal.fromMinorUnits(9_000_000_000_000_00n, SCALE_CENTS);
  expect(formatCurrency(big)).toBe("$9,000,000,000,000.00");
});

test("formatCurrencyCompact: millions with one decimal", () => {
  expect(formatCurrencyCompact(toCents(1_200_000))).toBe("$1.2M");
});

test("formatCurrencyCompact: whole millions drop the decimal", () => {
  expect(formatCurrencyCompact(toCents(2_000_000))).toBe("$2M");
});

test("formatCurrencyCompact: thousands round to the nearest k", () => {
  expect(formatCurrencyCompact(toCents(700_000))).toBe("$700k");
});

test("formatCurrencyCompact: sub-thousand rounds to whole dollars", () => {
  expect(formatCurrencyCompact(toCents(950))).toBe("$950");
});

test("formatCurrencyCompact: keeps the minus sign for negative millions", () => {
  // Regression: Math.abs once dropped the sign, rendering -$1.2M as "$1.2M".
  expect(formatCurrencyCompact(toCents(-1_200_000))).toBe("-$1.2M");
});

test("formatCurrencyCompact: keeps the minus sign for negative thousands and dollars", () => {
  expect(formatCurrencyCompact(toCents(-700_000))).toBe("-$700k");
  expect(formatCurrencyCompact(toCents(-950))).toBe("-$950");
});

test("formatCurrencyWhole: 1000000 returns $1,000,000", () => {
  expect(formatCurrencyWhole(toCents(1_000_000))).toBe("$1,000,000");
});
