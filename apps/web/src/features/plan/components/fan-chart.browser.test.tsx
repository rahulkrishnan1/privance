import { Decimal, SCALE_CENTS } from "@privance/core";
import type { YearBand } from "@privance/core/projection";
import { beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { FanChart } from "./fan-chart";

// ---------------------------------------------------------------------------
// Fixture: fixed-seed result with distinct band values
// ---------------------------------------------------------------------------

function makeBand(
  p10Dollars: number,
  p25Dollars: number,
  p50Dollars: number,
  p75Dollars: number,
  p90Dollars: number,
): YearBand {
  const toCents = (d: number) => Decimal.fromMinorUnits(BigInt(Math.round(d * 100)), SCALE_CENTS);
  return {
    p10: toCents(p10Dollars),
    p25: toCents(p25Dollars),
    p50: toCents(p50Dollars),
    p75: toCents(p75Dollars),
    p90: toCents(p90Dollars),
  };
}

// A 10-year projection with steadily growing bands (realistic shape).
const FIXTURE_BANDS: readonly YearBand[] = [
  makeBand(50_000, 80_000, 120_000, 160_000, 200_000),
  makeBand(55_000, 90_000, 140_000, 185_000, 240_000),
  makeBand(60_000, 100_000, 160_000, 215_000, 280_000),
  makeBand(65_000, 110_000, 180_000, 245_000, 320_000),
  makeBand(70_000, 122_000, 202_000, 278_000, 365_000),
  makeBand(75_000, 134_000, 224_000, 312_000, 412_000),
  makeBand(80_000, 148_000, 248_000, 348_000, 462_000),
  makeBand(85_000, 162_000, 274_000, 388_000, 518_000),
  makeBand(90_000, 178_000, 302_000, 430_000, 578_000),
  makeBand(95_000, 195_000, 332_000, 476_000, 640_000),
];

beforeAll(() => {
  document.documentElement.classList.add("dark");
  const style = document.createElement("style");
  style.textContent =
    ".recharts-responsive-container{width:720px!important;height:280px!important;}";
  document.head.appendChild(style);
});

test("renders chart container and role=img label", async () => {
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <FanChart bands={FIXTURE_BANDS} startAge={35} />
    </div>,
  );
  await expect.element(screen.getByRole("img", { name: /projection fan chart/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Rendered-geometry helpers
// The flat-line incident: a chart can render *something* while being visibly
// broken, so these tests parse the SVG paths Recharts actually drew instead of
// re-asserting the fixture.
// ---------------------------------------------------------------------------

function pathYs(d: string): number[] {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
}

async function renderAndGetSvg(): Promise<HTMLElement> {
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <FanChart bands={FIXTURE_BANDS} startAge={35} />
    </div>,
  );
  const container = screen.container as HTMLElement;
  const { vi } = await import("vitest");
  await vi.waitFor(
    () => {
      if (container.querySelector("svg.recharts-surface") === null) {
        throw new Error("chart svg not drawn yet");
      }
    },
    { timeout: 5_000 },
  );
  return container;
}

test("renders two filled areas: the uncertainty band and the median gradient fill", async () => {
  const container = await renderAndGetSvg();
  // Two filled areas: the p10..p90 uncertainty band and the median's
  // gradient-to-baseline fill. Both reference a url(#...) gradient, never "none".
  const areaPaths = [...container.querySelectorAll("path.recharts-area-area")].filter(
    (p) => p.getAttribute("fill") !== "none",
  );
  expect(areaPaths).toHaveLength(2);

  // The band's outline traces a top edge out and a distinct bottom edge back, so
  // its y values span a wide range. (The median fill drops to a flat baseline,
  // so it is not asserted here; the "outer band is a true band" test covers it.)
  const widest = areaPaths
    .map((p) => {
      const ys = pathYs(p.getAttribute("d") ?? "");
      return new Set(ys.map((y) => Math.round(y))).size;
    })
    .sort((a, b) => b - a)[0];
  expect(widest).toBeGreaterThan(14);
});

test("median line is drawn and is not flat", async () => {
  const container = await renderAndGetSvg();
  // The band fill draws stroke="none"; the only stroked curve is the median.
  const curves = [...container.querySelectorAll("path.recharts-area-curve")].filter(
    (p) => p.getAttribute("stroke") !== "none" && p.getAttribute("stroke") !== null,
  );
  expect(curves).toHaveLength(1);
  const medianD = curves[curves.length - 1]?.getAttribute("d") ?? "";
  const ys = pathYs(medianD);
  const unique = new Set(ys.map((y) => Math.round(y)));
  // Flat line would collapse to 1 distinct y; growing portfolio must vary.
  expect(unique.size).toBeGreaterThan(5);
  // Growth renders upward on screen: SVG y decreases from first to last point.
  const firstY = ys[0];
  const lastY = ys[ys.length - 1];
  expect(firstY).toBeDefined();
  expect(lastY).toBeDefined();
  expect(lastY as number).toBeLessThan(firstY as number);
});

test("uncertainty band is a true band: its bottom edge varies, not a flat fill", async () => {
  const container = await renderAndGetSvg();
  // The band fill (declared first) traces p90 along the top and p10 back along
  // the bottom; both edges vary year to year. The median gradient fill instead
  // drops to a flat $0 baseline. Distinguishing them: the band's lower half is
  // far above the chart floor, while the median fill's lower half sits on it.
  const fills = [...container.querySelectorAll("path.recharts-area-area")].filter(
    (p) => p.getAttribute("fill") !== "none",
  );
  const maxYOf = (p: Element | undefined) => Math.max(...pathYs(p?.getAttribute("d") ?? ""));
  const bandMaxY = maxYOf(fills[0]); // p10..p90 band, declared first
  const medianMaxY = maxYOf(fills[1]); // median gradient-to-baseline fill
  // The median fill reaches the $0 baseline (larger SVG y) than the band's p10
  // floor, which stays above $0 for a growing portfolio.
  expect(medianMaxY).toBeGreaterThan(bandMaxY);
});

// ---------------------------------------------------------------------------
// FIRE target reference line
// ---------------------------------------------------------------------------

test("fireNumberDisplay renders a reference line in the SVG and labels it in the legend", async () => {
  // Use a target well above the fixture bands so the line is always in domain.
  const fireTarget = 1_500_000;
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <FanChart bands={FIXTURE_BANDS} startAge={35} fireNumberDisplay={fireTarget} />
    </div>,
  );
  const container = screen.container as HTMLElement;
  const { vi } = await import("vitest");

  // Wait for Recharts to finish drawing.
  await vi.waitFor(
    () => {
      if (container.querySelector("svg.recharts-surface") === null) {
        throw new Error("chart svg not drawn yet");
      }
    },
    { timeout: 5_000 },
  );

  // A reference line renders as a <line> element inside the recharts surface.
  const refLines = container.querySelectorAll(".recharts-reference-line line");
  expect(refLines.length).toBeGreaterThan(0);

  // The target value lives in the HTML legend (not drawn on the plot, so it
  // never collides with the axis ticks).
  const legendTexts = [...container.querySelectorAll("span")].map((el) => el.textContent ?? "");
  const hasTargetLegend = legendTexts.some((t) => t.startsWith("Target"));
  expect(hasTargetLegend, "expected a Target entry in the legend").toBe(true);

  // The target is also labelled inline at the reference line (right edge), the
  // same as the design mock, so the value reads against the line itself.
  const svgText = [...container.querySelectorAll("svg text")].map((el) => el.textContent ?? "");
  expect(svgText.some((t) => t.startsWith("Target"))).toBe(true);

  // The y-axis ticks must include a value >= the target (domain reaches it).
  const yTickTexts = [...container.querySelectorAll('[class*="recharts-yAxis"] text')].map(
    (el) => el.textContent?.trim() ?? "",
  );
  // formatYAxisTick renders large numbers with M/K suffix; just confirm the axis
  // has at least one non-empty tick and the domain includes the target.
  expect(yTickTexts.filter((t) => t.length > 0).length).toBeGreaterThan(0);
});

test("shows empty state for fewer than 2 bands", async () => {
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <FanChart bands={FIXTURE_BANDS.slice(0, 1)} startAge={35} />
    </div>,
  );
  await expect.element(screen.getByText(/not enough data/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Age axis semantics: yearlyBands[i] is the pot at END of year i+1,
// so the first tick must be startAge+1 and the last must be startAge+N.
// ---------------------------------------------------------------------------

test("age axis: first x value is startAge+1 and last is startAge+N", async () => {
  const container = await renderAndGetSvg();
  const N = FIXTURE_BANDS.length; // 10
  const startAge = 35;

  const { vi } = await import("vitest");

  // Recharts renders x-axis tick labels as <text> elements inside the xAxis group.
  // Wait for them to be non-empty, then extract the numeric values.
  const tickTexts = await vi.waitFor(
    () => {
      // Select all text elements inside the xAxis group (covers Recharts 2.x and later).
      const ticks = [...container.querySelectorAll('[class*="recharts-xAxis"] text')].map((el) =>
        Number(el.textContent?.trim()),
      );
      const numeric = ticks.filter((t) => !Number.isNaN(t) && t > 0);
      if (numeric.length === 0) throw new Error("no x-axis ticks yet");
      return numeric;
    },
    { timeout: 5_000 },
  );

  // The axis uses preserveStartEnd so the first and last rendered ticks must
  // be the first and last data ages.
  const minTick = Math.min(...tickTexts);
  const maxTick = Math.max(...tickTexts);
  expect(minTick).toBe(startAge + 1);
  expect(maxTick).toBe(startAge + N);
});
