import type { BillingUnit } from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { LocalSpendItem } from "../types";
import {
  billedAmountCents,
  dailyEquivalentCents,
  defaultGroupForCategory,
  monthlyEquivalentCents,
  nextBillDate,
  subscriptionSharePct,
  totalAnnualCents,
  totalMonthlyCents,
  weeklyEquivalentCents,
} from "./_spend-math";

const monthly = (cents: string) => Decimal.fromMinorUnits(BigInt(cents), SCALE_CENTS);

// All assertions on .toString() strings, never on numbers

describe("monthlyEquivalentCents", () => {
  test("every-1-month is a no-op", () => {
    expect(monthlyEquivalentCents("1000", 1, "month").toString()).toBe("10.00");
  });

  test("yearly $216 / 12 = $18.00", () => {
    expect(monthlyEquivalentCents("21600", 1, "year").toString()).toBe("18.00");
  });

  test("quarterly = every 3 months: $90 / 3 = $30.00", () => {
    expect(monthlyEquivalentCents("9000", 3, "month").toString()).toBe("30.00");
  });

  test("weekly $10 * 52 / 12 = $43.33 (banker rounding)", () => {
    // 1000 cents * 12 / 52 = ... ; monthly = 10 * 52/12 = 43.33
    expect(monthlyEquivalentCents("1000", 1, "week").toString()).toBe("43.33");
  });

  test("daily $1 * 365 / 12 = $30.42", () => {
    // $1/day -> 100 cents * 365 / 12 / 100 = 30.4166.. -> banker 30.42
    expect(monthlyEquivalentCents("100", 1, "day").toString()).toBe("30.42");
  });

  test("every 2 years halves the yearly equivalent", () => {
    // $240 every 2 years -> $120/yr -> $10/mo
    expect(monthlyEquivalentCents("24000", 2, "year").toString()).toBe("10.00");
  });
});

function makeItem(
  amountCents: string,
  intervalCount: number,
  intervalUnit: BillingUnit,
  status: LocalSpendItem["status"],
): Pick<LocalSpendItem, "amountCents" | "intervalCount" | "intervalUnit" | "status"> {
  return { amountCents, intervalCount, intervalUnit, status };
}

describe("totalMonthlyCents", () => {
  test("empty list returns zero", () => {
    expect(totalMonthlyCents([]).toString()).toBe("0.00");
  });

  test("all active items summed", () => {
    const items = [
      makeItem("150000", 1, "month", "active"), // $1500/mo
      makeItem("10000", 1, "month", "active"), // $100/mo
    ];
    expect(totalMonthlyCents(items).toString()).toBe("1600.00");
  });

  test("paused items excluded from total", () => {
    const items = [
      makeItem("150000", 1, "month", "active"), // $1500/mo
      makeItem("1000", 1, "month", "paused"), // $10/mo - excluded
    ];
    expect(totalMonthlyCents(items).toString()).toBe("1500.00");
  });

  test("all paused returns zero", () => {
    const items = [
      makeItem("150000", 1, "month", "paused"),
      makeItem("5000", 1, "month", "paused"),
    ];
    expect(totalMonthlyCents(items).toString()).toBe("0.00");
  });
});

describe("totalAnnualCents", () => {
  test("delegates to totalMonthlyCents * 12", () => {
    const items = [makeItem("10000", 1, "month", "active")]; // $100/mo = $1200/yr
    expect(totalAnnualCents(items).toString()).toBe("1200.00");
  });

  test("property: total is unchanged by adding any number of paused items", () => {
    const cents = fc.integer({ min: 1, max: 100_000_000 }).map((n) => String(n));
    const count = fc.integer({ min: 1, max: 12 });
    const unit = fc.constantFrom<BillingUnit>("day", "week", "month", "year");
    const activeItem = fc.record({
      amountCents: cents,
      intervalCount: count,
      intervalUnit: unit,
      status: fc.constant("active" as const),
    });
    const pausedItem = fc.record({
      amountCents: cents,
      intervalCount: count,
      intervalUnit: unit,
      status: fc.constant("paused" as const),
    });

    fc.assert(
      fc.property(
        fc.array(activeItem, { maxLength: 20 }),
        fc.array(pausedItem, { maxLength: 20 }),
        (active, paused) => {
          const base = totalMonthlyCents(active).toString();
          const withPaused = totalMonthlyCents([...active, ...paused]).toString();
          expect(withPaused).toBe(base);
        },
      ),
    );
  });
});

describe("mixed-cycle aggregation", () => {
  test("sums monthly equivalents across all units", () => {
    // $1500/mo + $1200/yr ($100/mo) + $10/wk ($43.33/mo) + $90 every 3 months ($30/mo)
    const items = [
      makeItem("150000", 1, "month", "active"),
      makeItem("120000", 1, "year", "active"),
      makeItem("1000", 1, "week", "active"),
      makeItem("9000", 3, "month", "active"),
    ];
    expect(totalMonthlyCents(items).toString()).toBe("1673.33");
    expect(totalAnnualCents(items).toString()).toBe("20079.96");
  });

  test("property: monthly total is associative under concatenation of active lists", () => {
    const cents = fc.integer({ min: 1, max: 100_000_000 }).map((n) => String(n));
    const count = fc.integer({ min: 1, max: 12 });
    const unit = fc.constantFrom<BillingUnit>("day", "week", "month", "year");
    const activeItem = fc.record({
      amountCents: cents,
      intervalCount: count,
      intervalUnit: unit,
      status: fc.constant("active" as const),
    });

    fc.assert(
      fc.property(
        fc.array(activeItem, { maxLength: 20 }),
        fc.array(activeItem, { maxLength: 20 }),
        (a, b) => {
          const combined = totalMonthlyCents([...a, ...b]).toMinorUnits();
          const split = totalMonthlyCents(a).toMinorUnits() + totalMonthlyCents(b).toMinorUnits();
          expect(combined).toBe(split);
        },
      ),
    );
  });
});

describe("dailyEquivalentCents / weeklyEquivalentCents", () => {
  test("daily = monthly * 12 / 365 ($3000/mo -> $98.63)", () => {
    expect(dailyEquivalentCents(monthly("300000")).toString()).toBe("98.63");
  });

  test("weekly = monthly * 12 / 52 ($3000/mo -> $692.31)", () => {
    expect(weeklyEquivalentCents(monthly("300000")).toString()).toBe("692.31");
  });
});

describe("subscriptionSharePct", () => {
  test("subscriptions over total, rounded to a whole percent ($16 of $42 -> 38)", () => {
    expect(subscriptionSharePct(monthly("1600"), monthly("4200"))).toBe(38);
  });

  test("all spend is subscriptions -> 100", () => {
    expect(subscriptionSharePct(monthly("4200"), monthly("4200"))).toBe(100);
  });

  test("no spend -> 0 (no divide by zero)", () => {
    expect(subscriptionSharePct(monthly("0"), monthly("0"))).toBe(0);
  });
});

describe("defaultGroupForCategory", () => {
  test("housing, utilities, phone, insurance, health, transport, food default to essentials", () => {
    expect(defaultGroupForCategory("housing")).toBe("essentials");
    expect(defaultGroupForCategory("utilities")).toBe("essentials");
    expect(defaultGroupForCategory("phone")).toBe("essentials");
    expect(defaultGroupForCategory("insurance")).toBe("essentials");
    expect(defaultGroupForCategory("health")).toBe("essentials");
    expect(defaultGroupForCategory("transport")).toBe("essentials");
    expect(defaultGroupForCategory("food")).toBe("essentials");
  });

  test("other categories default to subscriptions", () => {
    expect(defaultGroupForCategory("streaming")).toBe("subscriptions");
    expect(defaultGroupForCategory("music")).toBe("subscriptions");
    expect(defaultGroupForCategory("software")).toBe("subscriptions");
  });
});

describe("nextBillDate", () => {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date(2026, 5, 15); // 2026-06-15, local

  test("returns a future anchor unchanged", () => {
    expect(iso(nextBillDate("2026-08-01", 1, "month", now))).toBe("2026-08-01");
  });

  test("rolls a past monthly anchor forward to the next occurrence on/after today", () => {
    // Anchor Jan 5; monthly -> first occurrence >= Jun 15 is Jul 5.
    expect(iso(nextBillDate("2026-01-05", 1, "month", now))).toBe("2026-07-05");
  });

  test("a same-day occurrence counts as not yet past (today is billed today)", () => {
    expect(iso(nextBillDate("2026-05-15", 1, "month", now))).toBe("2026-06-15");
  });

  test("rolls a yearly anchor to the next year", () => {
    expect(iso(nextBillDate("2024-03-01", 1, "year", now))).toBe("2027-03-01");
  });

  test("honors a multi-year interval", () => {
    // Every 2 years from 2020-09-01: 2022, 2024, 2026 (>= Jun 15) -> 2026-09-01.
    expect(iso(nextBillDate("2020-09-01", 2, "year", now))).toBe("2026-09-01");
  });

  test("rolls weekly anchors by whole weeks", () => {
    // 2026-06-01 + 7d = 06-08, + 7d = 06-15 (today) -> stops at 06-15.
    expect(iso(nextBillDate("2026-06-01", 1, "week", now))).toBe("2026-06-15");
  });

  test("rolls a past daily anchor forward to today", () => {
    expect(iso(nextBillDate("2026-06-10", 1, "day", now))).toBe("2026-06-15");
  });

  test("a very old daily anchor still reaches today, never a past date", () => {
    // Regression guard: an anchor a decade old must not exit with a stale past
    // date. Daily steps land exactly on today.
    expect(iso(nextBillDate("2016-01-01", 1, "day", now))).toBe("2026-06-15");
  });

  test("clamps the day to the target month length (Jan 31 monthly -> Feb 28)", () => {
    const feb = new Date(2026, 1, 10); // 2026-02-10
    expect(iso(nextBillDate("2026-01-31", 1, "month", feb))).toBe("2026-02-28");
  });

  test("tracks month-end across months instead of ratcheting down to the 28th", () => {
    // Each step is measured from the Jan 31 anchor, so viewed in March the bill
    // is Mar 31, not the Feb-clamped 28th carried forward.
    const mar = new Date(2026, 2, 10); // 2026-03-10
    expect(iso(nextBillDate("2026-01-31", 1, "month", mar))).toBe("2026-03-31");
  });
});

describe("billedAmountCents", () => {
  test("every-1-month returns null", () => {
    expect(billedAmountCents("10000", 1, "month")).toBeNull();
  });

  test("daily (the only other every-1 cadence) still returns the per-cycle amount", () => {
    expect(billedAmountCents("100", 1, "day")?.toString()).toBe("1.00");
  });

  test("yearly returns the per-cycle billed amount as a Decimal", () => {
    expect(billedAmountCents("21600", 1, "year")?.toString()).toBe("216.00");
  });

  test("every 3 months returns the per-cycle billed amount", () => {
    expect(billedAmountCents("9000", 3, "month")?.toString()).toBe("90.00");
  });

  test("weekly returns the per-cycle billed amount", () => {
    expect(billedAmountCents("1000", 1, "week")?.toString()).toBe("10.00");
  });

  test("fractional amount preserves cents", () => {
    expect(billedAmountCents("13999", 1, "year")?.toString()).toBe("139.99");
  });
});
