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

/**
 * Net worth history line chart with range selector.
 */
export function HistoryChart({ points }: HistoryChartProps) {
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

  return (
    <div
      className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 mb-4"
      role="img"
      aria-label="Net worth history chart"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Net Worth History
        </p>
      </div>

      <div className="mb-3">
        <RangeSelector selected={range} onChange={setRange} />
      </div>

      {chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">
            Net worth history will appear after a few days of usage.
          </p>
        </div>
      ) : (
        <div style={{ height: 200 }}>
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
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
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
