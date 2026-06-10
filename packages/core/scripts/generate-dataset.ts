/**
 * generate-dataset.ts
 *
 * Dev-time script (never runs at build or runtime).
 * Downloads the Shiller/datasets monthly S&P 500 CSV and transforms it into an
 * annual real-return series for US stocks and US bonds, emitting
 * packages/core/src/projection/dataset.ts.
 *
 * Run: bun packages/core/scripts/generate-dataset.ts
 *
 * Source:
 *   https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv
 *   License: ODC-PDDL (public domain)
 *   Derived from Robert Shiller's data (http://www.econ.yale.edu/~shiller/data.htm)
 *
 * Cross-check: Damodaran annual returns 1928 onward
 *   https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html
 *
 * Return conventions (stated once, applied consistently):
 *   Stocks: January-to-January real price change plus the January real dividend.
 *     real_return_stocks(y) = (realPrice[y+1] + realDividend[y]) / realPrice[y] - 1
 *     where realDividend[y] is the ANNUAL real dividend already as stored in
 *     Shiller's "Real Dividend" column (annual value, not monthly).
 *
 *   Bonds: constant-maturity approximation from the 10-year GS10 yield.
 *     The annual bond total return given a yield change:
 *       bond_return = coupon_yield - duration * delta_yield
 *     Duration approximation for a par bond: (1 - (1+y)^-10) / y
 *     All in nominal terms, then CPI-deflated.
 *
 *   End year: 2022 (last year with complete January-to-January real prices
 *   AND complete CPI and long-rate data in the source).
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv";

interface MonthRow {
  date: string; // YYYY-MM-DD
  year: number;
  month: number;
  sp500: number;
  // Shiller's dividend column is the ANNUAL dividend (not monthly).
  dividend: number;
  cpi: number;
  longRate: number; // GS10, percent
  realPrice: number;
  // Shiller's realDividend column is also the ANNUAL real dividend.
  realDividend: number;
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function parseCsv(raw: string): MonthRow[] {
  const lines = raw.trim().split("\n");
  const rows: MonthRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = cols[0].trim();
    const [yearStr, monthStr] = date.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const sp500 = Number(cols[1]);
    const dividend = Number(cols[2]); // Shiller annual dividend
    const cpi = Number(cols[4]);
    const longRate = Number(cols[5]);
    const realPrice = Number(cols[6]);
    const realDividend = Number(cols[7]); // Shiller annual real dividend

    // Skip rows with missing CPI or long rate (incomplete recent rows)
    if (!Number.isFinite(cpi) || cpi === 0 || !Number.isFinite(longRate) || longRate === 0) {
      continue;
    }

    rows.push({
      date,
      year,
      month,
      sp500,
      dividend,
      cpi,
      longRate,
      realPrice,
      realDividend,
    });
  }
  return rows;
}

interface JanuaryData {
  year: number;
  realPrice: number;
  // Annual real dividend (as stored in Shiller's Real Dividend column).
  annualRealDividend: number;
  cpi: number;
  longRate: number; // percent, e.g. 5.32
}

function extractJanuaries(rows: MonthRow[]): Map<number, JanuaryData> {
  const map = new Map<number, JanuaryData>();
  for (const r of rows) {
    if (r.month === 1) {
      map.set(r.year, {
        year: r.year,
        realPrice: r.realPrice,
        // realDividend is already the annual dividend in Shiller's dataset.
        annualRealDividend: r.realDividend,
        cpi: r.cpi,
        longRate: r.longRate,
      });
    }
  }
  return map;
}

interface AnnualReturn {
  year: number;
  stocksBps: number; // integer basis points
  bondsBps: number; // integer basis points
}

/**
 * Duration of a par coupon bond (approximate, level coupon):
 *   D = (1/y) * (1 - (1+y)^-N)
 * where y is yield per period (annual), N = 10 years.
 */
function bondDuration(yieldFrac: number): number {
  if (yieldFrac <= 0) return 10; // degenerate case
  return (1 / yieldFrac) * (1 - (1 + yieldFrac) ** -10);
}

function computeAnnualReturns(jans: Map<number, JanuaryData>): AnnualReturn[] {
  const results: AnnualReturn[] = [];

  const years = Array.from(jans.keys()).sort((a, b) => a - b);

  for (const year of years) {
    const curr = jans.get(year);
    const next = jans.get(year + 1);
    // curr is guaranteed to exist (we iterate over jans keys), but be explicit.
    if (!curr || !next) continue; // need both Jan values for the return

    // -----------------------------------------------------------------------
    // Stocks: real total return
    //   (realPrice[y+1] + annualRealDividend[y]) / realPrice[y] - 1
    // -----------------------------------------------------------------------
    const stockReturn = (next.realPrice + curr.annualRealDividend) / curr.realPrice - 1;

    // -----------------------------------------------------------------------
    // Bonds: nominal coupon + price change (constant-maturity), then real
    //   coupon_yield = longRate / 100
    //   delta_yield  = next.longRate/100 - curr.longRate/100
    //   duration     = bondDuration(coupon_yield)
    //   nominal_return = coupon_yield - duration * delta_yield
    //   inflation    = next.cpi / curr.cpi - 1
    //   real_return  = (1 + nominal_return) / (1 + inflation) - 1
    // -----------------------------------------------------------------------
    const couponYield = curr.longRate / 100;
    const deltaYield = next.longRate / 100 - couponYield;
    const duration = bondDuration(couponYield);
    const nominalBondReturn = couponYield - duration * deltaYield;
    const inflation = next.cpi / curr.cpi - 1;
    const bondReturn = (1 + nominalBondReturn) / (1 + inflation) - 1;

    // Convert to integer basis points (round half-up)
    const stocksBps = Math.round(stockReturn * 10000);
    const bondsBps = Math.round(bondReturn * 10000);

    results.push({ year, stocksBps, bondsBps });
  }

  // Return series starts at 1872 (needs 1871 and 1872 January prices).
  return results;
}

function formatTs(returns: AnnualReturn[], endYear: number): string {
  const rows = returns.map(
    (r) => `  { year: ${r.year}, stocksBps: ${r.stocksBps}, bondsBps: ${r.bondsBps} },`,
  );
  return `/**
 * dataset.ts -- GENERATED FILE, do not edit by hand.
 * Generator: packages/core/scripts/generate-dataset.ts
 *
 * Annual real total returns for US stocks and bonds, in integer basis points.
 * End year: ${endYear}
 *
 * Source:
 *   Robert Shiller via datasets/s-and-p-500 (ODC-PDDL / public domain)
 *   https://raw.githubusercontent.com/datasets/s-and-p-500/main/data/data.csv
 *   https://github.com/datasets/s-and-p-500
 *
 * Cross-check: Damodaran annual real returns 1928 onward
 *   https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html
 *
 * Return conventions:
 *   Stocks: January-to-January real price change plus January real dividend.
 *     Formula: (realPrice[y+1] + realDiv[y]) / realPrice[y] - 1
 *     realDiv[y] is Shiller's annual real dividend as stored (not monthly).
 *   Bonds: constant-maturity approximation from GS10 (10-year Treasury yield).
 *     nominal = couponYield - duration * deltaYield; then CPI-deflated.
 *     Duration approximation: (1/y)*(1-(1+y)^-10) for a par coupon bond.
 *   Values are integer basis points (1 bp = 0.01%).
 *
 * Integrity hash (sha-256 of this file's content): see dataset-hash.txt
 */

export interface ReturnRow {
  readonly year: number;
  /** Real total return for US stocks in basis points. */
  readonly stocksBps: number;
  /** Real total return for US bonds (GS10 constant-maturity) in basis points. */
  readonly bondsBps: number;
}

/**
 * Annual real returns, ${returns[0].year} to ${endYear}, in integer basis points.
 * row.year is the calendar year in which the return was earned (Jan to Jan).
 * 1 bps = 0.01%. Negative values indicate real losses.
 */
export const ANNUAL_RETURNS: readonly ReturnRow[] = [
${rows.join("\n")}
];

/** First year in the dataset. Uses Jan ${returns[0].year} and Jan ${returns[0].year + 1} prices. */
export const DATASET_START_YEAR = ${returns[0].year};

/** Last year in the dataset (${endYear}). */
export const DATASET_END_YEAR = ${endYear};
`;
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const csv = await fetchCsv(SOURCE_URL);
  const rows = parseCsv(csv);
  const jans = extractJanuaries(rows);
  const annualReturns = computeAnnualReturns(jans);

  const endYear = annualReturns[annualReturns.length - 1].year;
  console.log(`Dataset: ${annualReturns[0].year} to ${endYear} (${annualReturns.length} years)`);

  const outPath = join(import.meta.dirname, "../src/projection/dataset.ts");
  const content = formatTs(annualReturns, endYear);
  writeFileSync(outPath, content, "utf8");
  console.log(`Wrote ${outPath}`);

  // Compute and store hash
  const hash = createHash("sha256").update(content).digest("hex");
  const hashPath = join(import.meta.dirname, "../src/projection/dataset-hash.txt");
  writeFileSync(hashPath, hash, "utf8");
  console.log(`Hash (sha-256): ${hash}`);
  console.log(`Wrote hash to ${hashPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
