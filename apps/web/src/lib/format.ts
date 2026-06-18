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
  const sign = dollars < 0 ? "-" : "";
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${sign}$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
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
