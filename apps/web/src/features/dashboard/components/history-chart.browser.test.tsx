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
      const line = container.querySelector(".recharts-line-curve, path.recharts-curve");
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
  expect(screen.container.querySelector(".recharts-line-curve")).toBeNull();
});
