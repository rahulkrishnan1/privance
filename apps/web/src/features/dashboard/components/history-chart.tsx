"use client";

import { useEffect, useMemo, useState } from "react";
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
  /** Extra classes for the chart wrapper. */
  className?: string;
};

const HERO_RANGES: ChartRange[] = ["1M", "3M", "1Y", "5Y", "All"];

function filterByRange(
  points: HistoryPoint[],
  range: ChartRange,
  todayIso: string,
): HistoryPoint[] {
  if (range === "All" || points.length === 0) return points;

  const today = new Date(todayIso);
  const cutoff = new Date(today);

  switch (range) {
    case "1M":
      cutoff.setMonth(cutoff.getMonth() - 1);
      break;
    case "3M":
      cutoff.setMonth(cutoff.getMonth() - 3);
      break;
    case "1Y":
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      break;
    case "5Y":
      cutoff.setFullYear(cutoff.getFullYear() - 5);
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

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Net worth history chart. Seamless (no card): a teal area over faint gridlines
 * with the value scale overlaid at the right edge, beneath a quiet range row.
 */
export function HistoryChart({ points, className }: HistoryChartProps) {
  const [range, setRange] = useState<ChartRange>("3M");
  const colors = useChartColors();
  const reducedMotion = usePrefersReducedMotion();

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
  const yLabels = [yDomain[1], (yDomain[0] + yDomain[1]) / 2, yDomain[0]];

  return (
    <div
      className={["flex flex-col", className].filter(Boolean).join(" ")}
      role="img"
      aria-label="Net worth history chart"
    >
      <RangeSelector selected={range} onChange={setRange} ranges={HERO_RANGES} />

      {!hasEnoughData ? (
        <div className="mt-1.5 flex h-[170px] items-center justify-center md:h-[240px]">
          <p className="text-sm text-dim text-center">
            {points.length < 2
              ? "Net worth history will appear after a few days of usage."
              : "Not enough data for this range yet."}
          </p>
        </div>
      ) : (
        <div className="relative mt-1.5 h-[170px] md:h-[240px]">
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 0, height: 240 }}
          >
            <AreaChart data={chartData} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="nwHistoryFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={colors.line} stopOpacity={0.22} />
                  <stop offset="1" stopColor={colors.line} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="dateLabel" hide />
              <YAxis hide domain={yDomain} width={0} />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: "rgba(255,255,255,0.18)", strokeWidth: 1 }}
              />
              <Area
                type="monotone"
                dataKey="valueDisplay"
                stroke={colors.line}
                strokeWidth={2}
                fill="url(#nwHistoryFill)"
                dot={false}
                activeDot={{ r: 4, fill: colors.line, stroke: "none" }}
                isAnimationActive={!reducedMotion}
                animationDuration={1400}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Value scale, overlaid at the right edge. */}
          <div
            data-testid="history-y-scale"
            className="pointer-events-none absolute top-0 right-0 bottom-6 flex flex-col items-end justify-between"
          >
            {yLabels.map((v, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed 3-label scale
                key={i}
                className="vfig bg-vault px-1 font-mono text-xs text-faint"
              >
                {formatYAxisTick(v)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
