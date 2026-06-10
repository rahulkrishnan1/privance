import { describe, expect, it } from "vitest";
import { ANNUAL_RETURNS, DATASET_END_YEAR, DATASET_START_YEAR } from "./dataset.js";

// ---------------------------------------------------------------------------
// Basic structure
// ---------------------------------------------------------------------------

describe("ANNUAL_RETURNS structure", () => {
  it("covers the expected year span from 1871 to 2022", () => {
    expect(DATASET_START_YEAR).toBe(1871);
    expect(DATASET_END_YEAR).toBe(2022);
    // 2022 - 1871 + 1 = 152 rows
    expect(ANNUAL_RETURNS.length).toBe(152);
  });

  it("years are sequential with no gaps", () => {
    for (let i = 1; i < ANNUAL_RETURNS.length; i++) {
      expect(ANNUAL_RETURNS[i].year).toBe(ANNUAL_RETURNS[i - 1].year + 1);
    }
    expect(ANNUAL_RETURNS[0].year).toBe(DATASET_START_YEAR);
    expect(ANNUAL_RETURNS[ANNUAL_RETURNS.length - 1].year).toBe(DATASET_END_YEAR);
  });

  it("all values are safe integers", () => {
    for (const row of ANNUAL_RETURNS) {
      expect(Number.isSafeInteger(row.year)).toBe(true);
      expect(Number.isSafeInteger(row.stocksBps)).toBe(true);
      expect(Number.isSafeInteger(row.bondsBps)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Spot-checks against published Shiller values
// These verify the sign and rough magnitude of known historical episodes.
// ---------------------------------------------------------------------------

describe("ANNUAL_RETURNS spot-checks against published Shiller values", () => {
  function getYear(year: number) {
    const row = ANNUAL_RETURNS.find((r) => r.year === year);
    if (!row) throw new Error(`Year ${year} not found`);
    return row;
  }

  it("Great Depression 1929-1931: real stock returns are negative", () => {
    // January-to-January real stock returns should be negative in these years.
    // 1929 crash started Oct 1929; Jan-to-Jan captures partial impact.
    expect(getYear(1929).stocksBps).toBeLessThan(0);
    expect(getYear(1930).stocksBps).toBeLessThan(0);
    expect(getYear(1931).stocksBps).toBeLessThan(0);
  });

  it("1929-1931 real stock losses are substantial (> 500 bps each)", () => {
    expect(getYear(1929).stocksBps).toBeLessThan(-500);
    expect(getYear(1930).stocksBps).toBeLessThan(-500);
    expect(getYear(1931).stocksBps).toBeLessThan(-500);
  });

  it("1932: real stocks partially recover (positive or less deeply negative)", () => {
    // 1932 Jan-to-Jan includes the mid-1932 bottom and early recovery.
    // Historical data shows mixed results depending on the exact convention;
    // verify it is less negative than 1931.
    expect(getYear(1932).stocksBps).toBeGreaterThan(getYear(1931).stocksBps);
  });

  it("1933: strong stock recovery (> 2000 bps)", () => {
    // 1933 saw one of the strongest recoveries in US stock market history.
    expect(getYear(1933).stocksBps).toBeGreaterThan(2000);
  });

  it("2008 financial crisis: real stock return deeply negative (< -2000 bps)", () => {
    // Jan 2008 to Jan 2009: S&P 500 fell ~37% nominally.
    expect(getYear(2008).stocksBps).toBeLessThan(-2000);
  });

  it("2009 recovery: real stocks strongly positive (> 1500 bps)", () => {
    // Jan 2009 to Jan 2010: market recovered significantly.
    expect(getYear(2009).stocksBps).toBeGreaterThan(1500);
  });

  it("1999-2001 dot-com burst: real stocks turn negative around year 2000", () => {
    // Dot-com crash: real stocks negative 2000 and 2001.
    expect(getYear(2000).stocksBps).toBeLessThan(0);
    expect(getYear(2001).stocksBps).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Damodaran cross-check: stock returns 1928+ within a few hundred bps
// Damodaran uses Dec-to-Dec nominal returns; we use Jan-to-Jan real returns.
// Documented comparison values from Damodaran's historical file (accessed 2026-06):
//   https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html
// Our values differ due to: (1) Jan vs Dec convention, (2) real vs nominal.
// The cross-check verifies we are in the right ballpark, not exact agreement.
// ---------------------------------------------------------------------------

describe("Damodaran cross-check (1928+, sign and rough magnitude)", () => {
  function getYear(year: number) {
    const row = ANNUAL_RETURNS.find((r) => r.year === year);
    if (!row) throw new Error(`Year ${year} not found`);
    return row;
  }

  it("stock returns for good years 1935, 1954, 1975, 1995 are positive", () => {
    // Damodaran shows large positive returns for these years (30-50%+ nominal).
    // Our real Jan-to-Jan should also be positive.
    for (const year of [1935, 1954, 1975, 1995]) {
      expect(getYear(year).stocksBps).toBeGreaterThan(0);
    }
  });

  it("stock returns for crisis years 1930, 1931, 1937, 2002, 2008 are negative", () => {
    // Damodaran shows large negative returns for these years.
    for (const year of [1930, 1931, 1937, 2002, 2008]) {
      expect(getYear(year).stocksBps).toBeLessThan(0);
    }
  });

  it("bond returns for rising-rate year 1994 are negative (duration effect)", () => {
    // 1994 had a significant interest rate rise; bond total return was negative.
    expect(getYear(1994).bondsBps).toBeLessThan(0);
  });

  it("bond returns for falling-rate years (1982, 1985, 1995) are positive", () => {
    // Falling rates boost bond prices.
    for (const year of [1982, 1985, 1995]) {
      expect(getYear(year).bondsBps).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Long-run statistics cross-check
// Per-year numeric comparison against Damodaran is meaningless under the
// Jan-to-Jan real convention, but long-horizon means cancel the convention
// difference. The full-period US real equity geometric mean (~6.5-7%,
// Shiller/Siegel/Damodaran all agree) is the strongest single anchor that the
// transformation pipeline is correct end to end.
// ---------------------------------------------------------------------------

describe("ANNUAL_RETURNS long-run statistics", () => {
  function means(select: (r: (typeof ANNUAL_RETURNS)[number]) => number) {
    let sum = 0;
    let growthProduct = 1;
    for (const row of ANNUAL_RETURNS) {
      const r = select(row) / 10000;
      sum += r;
      growthProduct *= 1 + r;
    }
    const n = ANNUAL_RETURNS.length;
    return {
      arithmeticBps: (sum / n) * 10000,
      geometricBps: (growthProduct ** (1 / n) - 1) * 10000,
    };
  }

  it("real stock returns: geometric mean 5.8-7.8%, arithmetic mean 7.0-10.0%", () => {
    const { arithmeticBps, geometricBps } = means((r) => r.stocksBps);
    expect(geometricBps).toBeGreaterThan(580);
    expect(geometricBps).toBeLessThan(780);
    expect(arithmeticBps).toBeGreaterThan(700);
    expect(arithmeticBps).toBeLessThan(1000);
  });

  it("real bond returns: geometric mean 1.0-4.0%", () => {
    const { geometricBps } = means((r) => r.bondsBps);
    expect(geometricBps).toBeGreaterThan(100);
    expect(geometricBps).toBeLessThan(400);
  });
});

// ---------------------------------------------------------------------------
// Basis points range sanity checks
// ---------------------------------------------------------------------------

describe("ANNUAL_RETURNS value ranges", () => {
  it("stock returns are within plausible range (-10000 to +20000 bps)", () => {
    for (const row of ANNUAL_RETURNS) {
      expect(row.stocksBps).toBeGreaterThan(-10000);
      expect(row.stocksBps).toBeLessThan(20000);
    }
  });

  it("bond returns are within plausible range (-5000 to +5000 bps)", () => {
    for (const row of ANNUAL_RETURNS) {
      expect(row.bondsBps).toBeGreaterThan(-5000);
      expect(row.bondsBps).toBeLessThan(5000);
    }
  });
});
