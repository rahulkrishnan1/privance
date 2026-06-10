import type { Decimal } from "@privance/core";

/**
 * Format a Decimal currency value (in minor units, e.g. cents) for display.
 *
 * Defaults to USD. We use Intl.NumberFormat for locale-aware grouping and
 * sign placement; the Decimal -> Number coercion is lossy above 2^53 minor
 * units (~$90 trillion at cent precision), which is beyond any realistic
 * personal-finance value.
 */
export function formatCurrency(d: Decimal, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(d.toString()));
}

/** Whole-dollar display with no cents: same as formatCurrency but maximumFractionDigits: 0. */
export function formatCurrencyWhole(d: Decimal, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(d.toString()));
}

/**
 * Compact currency for tight displays (milestone cards, lever readouts):
 * "$1.2M", "$700k", "$950". Operates on the display dollar value; these are
 * presentational projections, so the float coercion is the format boundary.
 */
export function formatCurrencyCompact(d: Decimal): string {
  const dollars = Number(d.toString());
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) {
    const m = dollars / 1_000_000;
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) return `$${Math.round(dollars / 1_000)}k`;
  return `$${Math.round(dollars)}`;
}

/**
 * Whole-percent display for simulation probabilities: avoids false precision
 * and never rounds a nonzero share to an absolute 0% or 100%.
 */
export function formatPercentWhole(ratio: number): string {
  if (ratio > 0 && ratio < 0.01) return "<1%";
  if (ratio > 0.99 && ratio < 1) return ">99%";
  return `${Math.round(ratio * 100)}%`;
}

// en-US Intl currency output always uses "." as the decimal mark, so split on
// the last "." to peel off the cents segment.
export function formatCurrencyParts(
  d: Decimal,
  currency = "USD",
): { whole: string; cents: string } {
  const full = formatCurrency(d, currency);
  const idx = full.lastIndexOf(".");
  if (idx === -1) return { whole: full, cents: "" };
  return { whole: full.slice(0, idx), cents: full.slice(idx) };
}

/**
 * Format a ratio in [0, 1] as a percentage with 2 decimal places.
 * `signed: true` prepends "+" for positive non-zero values.
 *
 * Accepts a float because Decimal.div at cents scale truncates to whole-percent
 * precision (0.12 → "12.00" regardless of the true ratio). Callers compute the
 * ratio via float to keep the fractional digits.
 */
export function formatPercent(ratio: number, opts: { signed?: boolean } = {}): string {
  const value = ratio * 100;
  const prefix = opts.signed === true && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

/** ISO-8601 date (YYYY-MM-DD) → short month + day, e.g. "May 16". */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  if (year === undefined || month === undefined || day === undefined) return isoDate;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Epoch ms → "h:mm AM/PM" in the user's local timezone. */
export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
