import { Decimal, SCALE_CENTS } from "@privance/core";
import { beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { HistoryPoint } from "../types";
import { HistoryChart } from "./history-chart";

function pt(daysAgo: number, dollars: number): HistoryPoint {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const value = Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS);
  return { date: d.toISOString().slice(0, 10), valueDisplay: value.toFloat(), value };
}

// Parse a compact-currency axis label ("$1.06M", "$300K", "$750") to a number.
function parseTick(text: string): number {
  const m = text.match(/\$(-?[\d.]+)([KM]?)/);
  if (!m) return Number.NaN;
  const n = Number.parseFloat(m[1]);
  return m[2] === "M" ? n * 1_000_000 : m[2] === "K" ? n * 1_000 : n;
}

const HISTORY_POINTS = [
  pt(4, 900_000),
  pt(3, 920_000),
  pt(2, 940_000),
  pt(1, 960_000),
  pt(0, 980_000),
];

beforeAll(() => {
  document.documentElement.classList.add("dark");
  // Tailwind's compiled CSS (which sizes the chart card in the app) is not
  // loaded in the isolated component test, so give Recharts' ResponsiveContainer
  // an explicit viewport to measure. The bug under test is the axis domain, not
  // the container size, so a fixed harness size is faithful.
  const style = document.createElement("style");
  style.textContent =
    ".recharts-responsive-container{width:720px!important;height:280px!important;}";
  document.head.appendChild(style);
});

test("draws the net worth line zoomed to the data range, not anchored at $0", async () => {
  // Real-world near-flat history around $1.06M across three days -- the exact
  // shape that rendered as a flat line pinned to the top of a $0-based axis.
  const points = [pt(2, 1_062_753), pt(1, 1_061_980), pt(0, 1_061_316)];

  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <HistoryChart points={points} className="h-full" />
    </div>,
  );
  const container = screen.container as HTMLElement;

  // Recharts draws asynchronously once it has measured the container.
  await vi.waitFor(
    () => {
      const line = container.querySelector(".recharts-area-curve, path.recharts-curve");
      if (line === null) throw new Error("line not drawn yet");
    },
    { timeout: 5_000 },
  );

  const ticks = [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")]
    .map((n) => parseTick(n.textContent?.trim() ?? ""))
    .filter((n) => !Number.isNaN(n));

  expect(ticks.length).toBeGreaterThanOrEqual(2);
  // The fix: the axis zooms to the data. The old [0, max] axis put the bottom
  // tick at $0 and pinned the ~$1.06M line to the top as a flat bar.
  expect(Math.min(...ticks)).toBeGreaterThan(500_000);
});

test("shows the empty-state copy instead of a broken chart for a single data point", async () => {
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <HistoryChart points={[pt(0, 1_061_316)]} className="h-full" />
    </div>,
  );

  await expect
    .element(screen.getByText(/Net worth history will appear after a few days/i))
    .toBeVisible();
  expect(screen.container.querySelector(".recharts-area-curve")).toBeNull();
});

test("a range with too few points reports the range is short, not that history is missing", async () => {
  // History exists (a week of snapshots) but none fall inside the 1D window.
  // The copy must not claim there is no history yet (the misleading 1D
  // behavior); it should say the range is too short.
  const points = [pt(8, 1_061_000), pt(7, 1_061_500), pt(6, 1_062_000)];

  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <HistoryChart points={points} className="h-full" />
    </div>,
  );

  await screen.getByRole("button", { name: "1D range" }).click();

  // The either/or copy lives in one node, so the range-short message being
  // visible proves the cold-start message is not shown.
  await expect.element(screen.getByText(/Not enough data for this range yet/i)).toBeVisible();
});

test("dashboard chart carries no plan projection: no set-up prompt, no Projected range, no band", async () => {
  // Projections live in the Plan section, never on the dashboard. This guards
  // against re-introducing the projection band/range/prompt here.
  const screen = await render(
    <div style={{ width: 760, height: 340 }}>
      <HistoryChart points={HISTORY_POINTS} className="h-full" />
    </div>,
  );
  const container = screen.container as HTMLElement;

  await vi.waitFor(
    () => {
      if (container.querySelector("svg.recharts-surface") === null) {
        throw new Error("chart not drawn yet");
      }
    },
    { timeout: 5_000 },
  );

  // No "set up your plan" prompt linking to the Plan section.
  const promptLinks = [...container.querySelectorAll("a[href='/app/plan']")].filter((a) =>
    a.textContent?.includes("set up your plan"),
  );
  expect(promptLinks).toHaveLength(0);

  // No "Projected" range button.
  expect(container.querySelector("[aria-label='Projected range']")).toBeNull();

  // No filled band area path (the only Area has fill "none").
  const filledAreas = [...container.querySelectorAll("path.recharts-area-area")].filter(
    (p) => p.getAttribute("fill") !== "none" && p.getAttribute("fill") !== null,
  );
  expect(filledAreas).toHaveLength(0);
});
