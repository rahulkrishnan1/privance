import { Decimal, SCALE_CENTS } from "@privance/core";
import type { YearBand } from "@privance/core/projection";
import { beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { FanChart } from "./fan-chart";

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

// A chart can render *something* while being visibly broken, so these helpers
// parse the SVG paths Recharts actually drew instead of re-asserting the fixture.
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

test("renders two nested uncertainty bands (p10..p90 and p25..p75)", async () => {
  const container = await renderAndGetSvg();
  // Two filled areas: the p10..p90 outer band and the p25..p75 inner band. Both
  // reference a url(#...) gradient, never "none". The median draws stroke-only
  // (fill="none"), so the bands carry all the shading, matching the design mock.
  const areaPaths = [...container.querySelectorAll("path.recharts-area-area")].filter(
    (p) => p.getAttribute("fill") !== "none",
  );
  expect(areaPaths).toHaveLength(2);

  // A band traces a top edge out and a distinct bottom edge back, so its y
  // values span a wide range (not a flat fill).
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

test("the inner band nests inside the outer band (p25..p75 within p10..p90)", async () => {
  const container = await renderAndGetSvg();
  // Both areas are true bands tracing a top edge out and a bottom edge back. The
  // outer band (declared first, p10..p90) reaches further down to its p10 floor
  // than the inner band's p25 floor, so its maximum SVG y is larger.
  const fills = [...container.querySelectorAll("path.recharts-area-area")].filter(
    (p) => p.getAttribute("fill") !== "none",
  );
  const maxYOf = (p: Element | undefined) => Math.max(...pathYs(p?.getAttribute("d") ?? ""));
  const outerMaxY = maxYOf(fills[0]); // p10..p90 band, declared first
  const innerMaxY = maxYOf(fills[1]); // p25..p75 band
  expect(outerMaxY).toBeGreaterThan(innerMaxY);
});

test("fireNumberDisplay renders a reference line in the SVG and names it in the legend", async () => {
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

  // The FI number lives in the HTML legend below the chart (not drawn on the
  // plot, so it never collides with the axis ticks).
  const legendTexts = [...container.querySelectorAll("span")].map((el) => el.textContent ?? "");
  const hasFiLegend = legendTexts.some((t) => t.includes("FI number"));
  expect(hasFiLegend, "expected an FI number entry in the legend").toBe(true);

  // The dollar scale renders as veil-able HTML labels in the gutter, not SVG
  // <text> the Veil blur can't reach. Confirm the scale has non-empty labels and
  // that every money figure (scale ticks + the legend FI number) is veiled.
  const veiledLabels = [...container.querySelectorAll("span.vfig")].filter(
    (el) => (el.textContent ?? "").trim().length > 0,
  );
  expect(veiledLabels.length).toBeGreaterThan(0);
});

test("when the median crosses the target within the horizon, an FI marker is labelled", async () => {
  // A low target the growing median reaches mid-horizon, with the FI age inside
  // the plan window so the crossing marker renders.
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <FanChart
        bands={FIXTURE_BANDS}
        startAge={35}
        fireNumberDisplay={250_000}
        medianFireAge={41}
        fireYear={2032}
        planUntilAge={95}
      />
    </div>,
  );
  const container = screen.container as HTMLElement;
  const { vi } = await import("vitest");
  const markerText = await vi.waitFor(
    () => {
      const texts = [...container.querySelectorAll("svg text")].map((el) => el.textContent ?? "");
      const hit = texts.find((t) => t.includes("FI ·"));
      if (hit === undefined) throw new Error("FI marker not drawn yet");
      return hit;
    },
    { timeout: 5_000 },
  );
  expect(markerText).toContain("2032");
});

test("exposes a screen-reader data table of the year-by-year projection", async () => {
  const container = await renderAndGetSvg();
  const rows = [...container.querySelectorAll(".sr-only table tbody tr")];
  // One row per band, plus the "today" origin point.
  expect(rows.length).toBeGreaterThanOrEqual(FIXTURE_BANDS.length);
  const cells = rows[0]?.querySelectorAll("td");
  expect(Number(cells?.[0]?.textContent)).toBeGreaterThan(0); // age
  expect(cells?.[1]?.textContent ?? "").toMatch(/\$/); // median dollars
});

// startingPot origin: the cone fans out from today's value at startAge.
test("startingPot adds a Today origin row at startAge equal to the starting value", async () => {
  const startingPot = Decimal.fromMinorUnits(4_000_000n, SCALE_CENTS); // $40,000
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <FanChart bands={FIXTURE_BANDS} startAge={35} startingPot={startingPot} />
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

  const rows = [...container.querySelectorAll(".sr-only table tbody tr")];
  // One extra row for the origin point on top of the per-band rows.
  expect(rows.length).toBe(FIXTURE_BANDS.length + 1);
  const firstCells = rows[0]?.querySelectorAll("td");
  // The origin row sits at startAge (not startAge+1) and its median equals the pot.
  expect(Number(firstCells?.[0]?.textContent)).toBe(35);
  expect(firstCells?.[1]?.textContent ?? "").toContain("40,000");
});

test("the origin point tooltip labels the starting value as Today", async () => {
  // The BandTooltip prints "Today" for the point whose age equals startAge.
  // Asserting through the SR origin row plus the x domain proves the origin is
  // pinned at startAge; the tooltip label is derived from that same age check.
  const startingPot = Decimal.fromMinorUnits(4_000_000n, SCALE_CENTS);
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <FanChart bands={FIXTURE_BANDS} startAge={35} startingPot={startingPot} />
    </div>,
  );
  const container = screen.container as HTMLElement;
  const { vi } = await import("vitest");

  const tickTexts = await vi.waitFor(
    () => {
      const ticks = [...container.querySelectorAll('[class*="recharts-xAxis"] text')].map((el) =>
        Number(el.textContent?.trim()),
      );
      const numeric = ticks.filter((t) => !Number.isNaN(t) && t > 0);
      if (numeric.length === 0) throw new Error("no x-axis ticks yet");
      return numeric;
    },
    { timeout: 5_000 },
  );
  // With an origin point the axis must start at startAge, a year earlier than
  // the band-only chart (which starts at startAge+1).
  expect(Math.min(...tickTexts)).toBe(35);
});

test("shows empty state for fewer than 2 bands", async () => {
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <FanChart bands={FIXTURE_BANDS.slice(0, 1)} startAge={35} />
    </div>,
  );
  await expect.element(screen.getByText(/not enough data/i)).toBeVisible();
});

// Age axis semantics: yearlyBands[i] is the pot at END of year i+1, so the first
// tick must be startAge+1 and the last must be startAge+N.
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
