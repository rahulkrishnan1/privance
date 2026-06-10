"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatYAxisTick, niceCeil } from "@/lib/chart";
import { useChartColors } from "@/lib/chart-colors";
import { formatDate } from "@/lib/format";
import type { ChartRange, HistoryPoint } from "../types";
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
  dateLabel: string;
  valueDisplay?: number;
  value?: HistoryPoint["value"];
};

// Zoom the Y axis to the data with headroom rather than anchoring at $0, so the
// trend is visible. A minimum span (~1.5% of the value) keeps a near-flat series
// from pinning the line to an edge or collapsing the tick labels.
export function computeYDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = (min + max) / 2;
  const half = Math.max((max - min) / 2, Math.abs(mid) * 0.015, 1) * 1.3;
  const lower = min >= 0 ? Math.max(0, mid - half) : mid - half;
  return [lower, niceCeil(mid + half)];
}

/** Net worth history line chart with a date-range selector. */
export function HistoryChart({ points, className }: HistoryChartProps) {
  const [range, setRange] = useState<ChartRange>("3M");
  const colors = useChartColors();

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const chartData = useMemo<ChartDataPoint[]>(() => {
    return filterByRange(points, range, todayIso).map((p) => ({
      date: p.date,
      valueDisplay: p.valueDisplay,
      value: p.value,
      dateLabel: formatDate(p.date),
    }));
  }, [points, range, todayIso]);

  const yDomain = useMemo(() => {
    const values = chartData.map((d) => d.valueDisplay).filter((v): v is number => v !== undefined);
    return computeYDomain(values);
  }, [chartData]);

  const hasEnoughData = chartData.length >= 2;

  return (
    <div
      className={["rounded-xl border border-app-line bg-app-panel p-4 flex flex-col", className]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label="Net worth history chart"
    >
      <div className="mb-3">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
          Net worth history
        </p>
      </div>

      <div className="mb-3">
        <RangeSelector selected={range} onChange={setRange} />
      </div>

      {!hasEnoughData ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center">
          <p className="text-sm text-app-muted text-center">
            {points.length < 2
              ? "Net worth history will appear after a few days of usage."
              : "Not enough data for this range yet."}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-[240px]">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 0, height: 240 }}
          >
            <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fontSize: 10, fill: colors.text }}
                axisLine={{ stroke: colors.grid }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 10, fill: colors.text }}
                axisLine={false}
                tickLine={false}
                width={48}
                domain={yDomain}
                tickFormatter={formatYAxisTick}
              />
              <Tooltip content={<ChartTooltip />} />

              <Area
                type="monotone"
                dataKey="valueDisplay"
                stroke={colors.line}
                strokeWidth={2}
                fill="none"
                dot={false}
                activeDot={{ r: 4, fill: colors.line }}
                isAnimationActive={false}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
