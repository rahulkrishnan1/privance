"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate } from "@/lib/format";
import type { ChartRange, HistoryPoint } from "../types";
import { useChartColors } from "../use-chart-colors";
import { ChartTooltip } from "./chart-tooltip";
import { RangeSelector } from "./range-selector";

type HistoryChartProps = {
  points: HistoryPoint[];
  /** Extra classes for the chart card, e.g. grid column span on the dashboard. */
  className?: string;
};

function filterByRange(
  points: HistoryPoint[],
  range: ChartRange,
  todayIso: string,
): HistoryPoint[] {
  if (range === "All" || points.length === 0) return points;

  const today = new Date(todayIso);
  let cutoff: Date;

  switch (range) {
    case "1D":
      cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 1);
      break;
    case "1W":
      cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 7);
      break;
    case "1M":
      cutoff = new Date(today);
      cutoff.setMonth(cutoff.getMonth() - 1);
      break;
    case "3M":
      cutoff = new Date(today);
      cutoff.setMonth(cutoff.getMonth() - 3);
      break;
    case "6M":
      cutoff = new Date(today);
      cutoff.setMonth(cutoff.getMonth() - 6);
      break;
    case "1Y":
      cutoff = new Date(today);
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      break;
  }

  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= cutoffIso);
}

type ChartDataPoint = {
  date: string;
  valueDisplay: number;
  value: HistoryPoint["value"];
  dateLabel: string;
};

// Compact currency ($1.06M, $300K, $750). Hand-rolled rather than
// Intl.NumberFormat({notation:"compact"}) because Intl's trailing-zero output
// varies by the runtime's ICU version (e.g. "$1.5M" locally vs "$1.50M" in CI),
// which made the labels non-deterministic. Two fraction digits keeps adjacent
// ticks distinct when the axis is zoomed to a narrow range.
export function formatYAxisTick(v: number): string {
  const sign = v < 0 ? "-" : "";
  const n = Math.abs(v);
  if (n >= 1_000_000) return `${sign}$${stripTrailingZeros((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `${sign}$${stripTrailingZeros((n / 1_000).toFixed(2))}K`;
  return `${sign}$${Math.round(n)}`;
}

function stripTrailingZeros(s: string): string {
  return s.replace(/\.?0+$/, "");
}

// Zoom the Y axis to the data with headroom rather than anchoring at $0, so the
// trend is visible. A minimum span (~1.5% of the value) keeps a near-flat series
// from pinning the line to an edge or collapsing the tick labels.
export function computeYDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = (min + max) / 2;
  const half = Math.max((max - min) / 2, Math.abs(mid) * 0.015, 1) * 1.3;
  return [mid - half, mid + half];
}

/**
 * Net worth history line chart with range selector.
 */
export function HistoryChart({ points, className }: HistoryChartProps) {
  const [range, setRange] = useState<ChartRange>("3M");
  const colors = useChartColors();

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const chartData = useMemo<ChartDataPoint[]>(() => {
    const filtered = filterByRange(points, range, todayIso);
    return filtered.map((p) => ({
      date: p.date,
      valueDisplay: p.valueDisplay,
      value: p.value,
      dateLabel: formatDate(p.date),
    }));
  }, [points, range, todayIso]);

  const yDomain = useMemo(() => computeYDomain(chartData.map((d) => d.valueDisplay)), [chartData]);

  return (
    <div
      className={["rounded-xl border border-app-line bg-app-panel p-4 flex flex-col", className]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label="Net worth history chart"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
          Net worth history
        </p>
      </div>

      <div className="mb-3">
        <RangeSelector selected={range} onChange={setRange} />
      </div>

      {chartData.length < 2 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center">
          <p className="text-sm text-app-muted text-center">
            {points.length < 2
              ? "Net worth history will appear after a few days of usage."
              : "Not enough data for this range yet."}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 10, fill: colors.text }}
                axisLine={{ stroke: colors.grid }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: colors.text }}
                axisLine={false}
                tickLine={false}
                width={60}
                domain={yDomain}
                tickFormatter={formatYAxisTick}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="valueDisplay"
                stroke={colors.line}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: colors.line }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
