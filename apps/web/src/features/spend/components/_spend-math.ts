import type { BillingUnit, SpendCategory, SpendGroup } from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";
import { ESSENTIALS_CATEGORIES } from "../_constants";
import type { LocalSpendItem } from "../types";

// [numerator, denominator] for charges-per-month of a unit:
// monthly = amount * num / (den * intervalCount). A month averages 52/12 weeks
// and 365/12 days, so weekly/daily use those ratios rather than a flat 4 or 30.
const MONTHLY_FACTOR: Record<BillingUnit, [bigint, bigint]> = {
  day: [365n, 12n],
  week: [52n, 12n],
  month: [1n, 1n],
  year: [1n, 12n],
};

export function monthlyEquivalentCents(
  amountCents: string,
  intervalCount: number,
  intervalUnit: BillingUnit,
): Decimal {
  const amount = Decimal.fromMinorUnits(BigInt(amountCents), SCALE_CENTS);
  const [num, den] = MONTHLY_FACTOR[intervalUnit];
  const divisor = den * BigInt(intervalCount);
  return amount
    .mul(Decimal.fromMinorUnits(num, 0))
    .div(Decimal.fromMinorUnits(divisor, 0), "banker");
}

export function totalMonthlyCents(
  items: Pick<LocalSpendItem, "amountCents" | "intervalCount" | "intervalUnit" | "status">[],
): Decimal {
  return items
    .filter((item) => item.status === "active")
    .reduce(
      (sum, item) =>
        sum.add(monthlyEquivalentCents(item.amountCents, item.intervalCount, item.intervalUnit)),
      Decimal.zero(SCALE_CENTS),
    );
}

export function totalAnnualCents(
  items: Pick<LocalSpendItem, "amountCents" | "intervalCount" | "intervalUnit" | "status">[],
): Decimal {
  return totalMonthlyCents(items).mul(Decimal.fromMinorUnits(12n, 0));
}

// Monthly spend reframed to a smaller grain: per day (monthly * 12 / 365) and
// per week (* 12 / 52). Display-only views of the same total.
export function dailyEquivalentCents(monthly: Decimal): Decimal {
  return monthly.mul(Decimal.fromMinorUnits(12n, 0)).div(Decimal.fromMinorUnits(365n, 0), "banker");
}

export function weeklyEquivalentCents(monthly: Decimal): Decimal {
  return monthly.mul(Decimal.fromMinorUnits(12n, 0)).div(Decimal.fromMinorUnits(52n, 0), "banker");
}

// Subscriptions as a whole-number percent of total monthly spend; 0 when there
// is no active spend. A ratio, not a money figure, so it is not veiled.
export function subscriptionSharePct(subscriptionMonthly: Decimal, totalMonthly: Decimal): number {
  if (totalMonthly.isZero()) return 0;
  return Math.round(
    subscriptionMonthly.mul(Decimal.fromMinorUnits(100n, 0)).div(totalMonthly, "banker").toFloat(),
  );
}

// The per-cycle billed amount for an item that is not billed plainly monthly
// (e.g. the $216 a yearly item charges), or null for the every-1-month case.
// The caller formats it at the UI boundary; money stays a Decimal here.
export function billedAmountCents(
  amountCents: string,
  intervalCount: number,
  intervalUnit: BillingUnit,
): Decimal | null {
  if (intervalCount === 1 && intervalUnit === "month") return null;
  return Decimal.fromMinorUnits(BigInt(amountCents), SCALE_CENTS);
}

// Suggested panel for a category when adding an item; the user can override.
export function defaultGroupForCategory(category: SpendCategory): SpendGroup {
  return ESSENTIALS_CATEGORIES.has(category) ? "essentials" : "subscriptions";
}

// Add whole months to a date, clamping the day to the target month's length so
// e.g. Jan 31 + 1 month is Feb 28, not a spill into March. Derived from the
// passed date's day-of-month, so a caller that always passes the original anchor
// keeps tracking month-end (Jan 31 -> Feb 28 -> Mar 31) instead of ratcheting
// down to the 28th.
function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getDate();
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

// Whole calendar days between two local-midnight dates, via UTC so a daylight
// saving transition in between can't shave the count by an hour.
function wholeDaysBetween(from: Date, to: Date): number {
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((utcTo - utcFrom) / 86_400_000);
}

// The next charge on or after `now`, rolled forward from the user-entered anchor.
// Display-only; keeps a stored date from going stale without any background job.
// `anchorIso` is a YYYY-MM-DD string. The step count is computed directly rather
// than by iterating, so the result is always on or after today no matter how old
// the anchor is, and each step is measured from the original anchor.
export function nextBillDate(
  anchorIso: string,
  intervalCount: number,
  intervalUnit: BillingUnit,
  now: Date,
): Date {
  const anchor = new Date(`${anchorIso}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (anchor >= today) return anchor;

  if (intervalUnit === "day" || intervalUnit === "week") {
    const stepDays = (intervalUnit === "week" ? 7 : 1) * intervalCount;
    const steps = Math.ceil(wholeDaysBetween(anchor, today) / stepDays);
    const next = new Date(anchor);
    next.setDate(next.getDate() + steps * stepDays);
    return next;
  }

  const stepMonths = (intervalUnit === "year" ? 12 : 1) * intervalCount;
  const monthsElapsed =
    (today.getFullYear() - anchor.getFullYear()) * 12 + (today.getMonth() - anchor.getMonth());
  let steps = Math.max(0, Math.floor(monthsElapsed / stepMonths));
  let next = addMonthsClamped(anchor, steps * stepMonths);
  // monthsElapsed ignores day-of-month, so the estimate can land one step short.
  while (next < today) {
    steps += 1;
    next = addMonthsClamped(anchor, steps * stepMonths);
  }
  return next;
}
