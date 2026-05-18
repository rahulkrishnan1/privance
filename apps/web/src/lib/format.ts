import type { Decimal } from "@privance/core";

/**
 * Format a Decimal currency value (in minor units, e.g. cents) for display.
 *
 * Defaults to USD. We use Intl.NumberFormat for locale-aware grouping and
 * sign placement; the Decimal → Number coercion is lossy above 2^53 minor
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
