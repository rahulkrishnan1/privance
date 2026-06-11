"use client";

import type { Decimal } from "@privance/core";
import type { YearBand } from "@privance/core/projection";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatYAxisTick, niceTicks } from "@/lib/chart";
import { useChartColors } from "@/lib/chart-colors";
import { formatCurrencyCompact, formatCurrencyWhole } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FanChartPoint {
  age: number;
  // Uncertainty band as a [low, high] pair (p10..p90), drawn as one faint fill.
  outer: [number, number];
  p10Display: number;
  p50Display: number;
  p90Display: number;
  // Decimal originals for the tooltip.
  p10: Decimal;
  p25: Decimal;
  p50: Decimal;
  p75: Decimal;
  p90: Decimal;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

type BandTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: FanChartPoint }>;
  label?: string | number;
  startAge?: number;
};

function BandTooltip({ active, payload, label, startAge }: BandTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (pt === undefined) return null;
  const isToday = startAge !== undefined && pt.age === startAge;
  return (
    <div className="rounded-lg border border-app-line/70 bg-app-panel-2/95 px-3 py-2.5 text-xs shadow-lg shadow-black/30 backdrop-blur-sm">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-app-dim">
        {isToday ? "Today" : `Age ${label}`}
      </p>
      <div className="flex items-center justify-between gap-5">
        <span className="flex items-center gap-2 text-app-text">
          <span className="h-px w-3 bg-gold-accent" />
          Median
        </span>
        <span className="font-semibold tabular-nums text-app-text">
          {formatCurrencyWhole(pt.p50)}
        </span>
      </div>
      {!isToday && (
        <>
          <div className="mt-2 flex items-center justify-between gap-5 text-app-muted">
            <span>Middle 50%</span>
            <span className="tabular-nums">
              {formatCurrencyCompact(pt.p25)} to {formatCurrencyCompact(pt.p75)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-5 text-app-muted">
            <span>Middle 80%</span>
            <span className="tabular-nums">
              {formatCurrencyCompact(pt.p10)} to {formatCurrencyCompact(pt.p90)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FanChart
// ---------------------------------------------------------------------------

type FanChartProps = {
  bands: readonly YearBand[];
  startAge: number;
  className?: string;
  /** Display float of the FIRE target; draws a dashed reference line. */
  fireNumberDisplay?: number;
  /** Starting portfolio (today); the cone originates here at startAge. */
  startingPot?: Decimal;
  /** Median FIRE age; draws a vertical marker when reached within the horizon. */
  medianFireAge?: number;
  /** Plan-until age; medianFireAge === planUntilAge is the never-reached sentinel. */
  planUntilAge?: number;
};

/**
 * Projection chart. A confident gold median line is the hero, with a soft
 * gradient fill fading to the $0 baseline; a single barely-there gold band
 * (p10..p90) hints at the outcome range without competing. The line originates
 * at the starting portfolio ("today"). Float values live only at the display
 * boundary; Decimal originals are kept for the tooltip.
 */
export function FanChart({
  bands,
  startAge,
  className,
  fireNumberDisplay,
  startingPot,
  medianFireAge,
  planUntilAge,
}: FanChartProps) {
  const colors = useChartColors();
  const gold = colors.line;

  const chartData = useMemo<FanChartPoint[]>(() => {
    const points: FanChartPoint[] = [];
    // Origin: today's value. All percentiles share it, so the cone fans out
    // from the starting portfolio instead of starting a year in.
    if (startingPot !== undefined) {
      const v = startingPot.toFloat();
      points.push({
        age: startAge,
        outer: [v, v],
        p10Display: v,
        p50Display: v,
        p90Display: v,
        p10: startingPot,
        p25: startingPot,
        p50: startingPot,
        p75: startingPot,
        p90: startingPot,
      });
    }
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      if (b === undefined) continue;
      const p10 = b.p10.toFloat();
      const p50 = b.p50.toFloat();
      const p90 = b.p90.toFloat();
      points.push({
        age: startAge + i + 1,
        outer: [p10, p90],
        p10Display: p10,
        p50Display: p50,
        p90Display: p90,
        p10: b.p10,
        p25: b.p25,
        p50: b.p50,
        p75: b.p75,
        p90: b.p90,
      });
    }
    return points;
  }, [bands, startAge, startingPot]);

  // Scale the y-axis to the MEDIAN (and the target), not the p90 tail. The p90
  // compounds to absurd values over decades; scaling to it flat-lines the
  // median at the bottom. Headroom of ~1.5x the median keeps the line filling
  // the plot while the band clips naturally at the top.
  const medianMax = useMemo(() => {
    const meds = chartData.map((d) => d.p50Display);
    return meds.length > 0 ? Math.max(...meds) : 1;
  }, [chartData]);
  const yTicks = useMemo((): number[] => {
    const target = fireNumberDisplay !== undefined && fireNumberDisplay > 0 ? fireNumberDisplay : 0;
    const candidateMax = Math.max(medianMax * 1.5, target * 1.3, 1);
    return niceTicks(candidateMax, 5);
  }, [medianMax, fireNumberDisplay]);
  // Zero baseline: depletion is the semantic floor of a projection.
  const yDomain = useMemo<[number, number]>(() => [0, yTicks[yTicks.length - 1] ?? 1], [yTicks]);

  // X ticks every ~5 years (a 30-year axis labelled per-year is unreadable),
  // always including the first and last age.
  const xTicks = useMemo<number[]>(() => {
    if (chartData.length === 0) return [];
    const first = chartData[0].age;
    const last = chartData[chartData.length - 1].age;
    const set = new Set<number>([first, last]);
    for (let a = Math.ceil(first / 5) * 5; a <= last; a += 5) set.add(a);
    return [...set].sort((a, b) => a - b);
  }, [chartData]);
  const firstAge = chartData[0]?.age ?? startAge;

  const showFireMarker =
    medianFireAge !== undefined &&
    planUntilAge !== undefined &&
    medianFireAge < planUntilAge &&
    medianFireAge > firstAge;

  if (chartData.length < 2) {
    return (
      <div
        className={[
          "rounded-xl border border-app-line bg-app-panel p-4 flex items-center justify-center min-h-[224px]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <p className="text-sm text-app-muted">Not enough data to render the chart.</p>
      </div>
    );
  }

  return (
    <div
      className={["rounded-xl border border-app-line bg-app-panel p-4 flex flex-col", className]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label="Projection fan chart"
    >
      {/* Legend only; the "Portfolio projection" title is lifted out to a
          section eyebrow above the card (ResultsPanel), matching the other
          sections. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-5 text-[11px] text-app-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded bg-gold-accent" />
          Median
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-3.5 rounded-sm bg-gold-accent/[0.08]" />
          Range
        </span>
        {fireNumberDisplay !== undefined && fireNumberDisplay > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-3.5 border-t border-dashed border-app-muted/70" />
            Target {formatYAxisTick(fireNumberDisplay)}
          </span>
        )}
      </div>

      {/* Fixed height: ResponsiveContainer's height="100%" cannot resolve
          against a flex-1 min-h parent (renders 0-high in the real app).
          Shorter on phones so the whole chart, including the age axis, fits the
          viewport above the bottom nav. */}
      <div className="h-64 md:h-80">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 320 }}
        >
          <AreaChart data={chartData} margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
            <defs>
              {/* Soft fill beneath the median: gold near the line, fading to
                  transparent toward the $0 baseline. This is the chart's hero. */}
              <linearGradient id="fanMedian" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={gold} stopOpacity={0.22} />
                <stop offset="100%" stopColor={gold} stopOpacity={0} />
              </linearGradient>
              {/* Whisper-faint uncertainty band (p10..p90); hints at the range
                  without competing with the median. Exact percentiles are in the
                  tooltip. */}
              <linearGradient id="fanRange" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={gold} stopOpacity={0.09} />
                <stop offset="100%" stopColor={gold} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            {/* No horizontal rules: the left dollar labels carry the scale and
                keep the plot airy, matching the projection's restrained style. */}
            <XAxis
              dataKey="age"
              type="number"
              domain={[firstAge, "dataMax"]}
              ticks={xTicks}
              tick={{ fontSize: 10, fill: colors.text }}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              height={40}
              label={{
                value: "Age",
                position: "insideBottom",
                offset: 0,
                fontSize: 10,
                fill: colors.text,
              }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: colors.text }}
              axisLine={false}
              tickLine={false}
              width={44}
              domain={yDomain}
              ticks={yTicks}
              tickFormatter={formatYAxisTick}
              // Respect the median-scaled domain and clip the p90 band at the top
              // instead of expanding the axis back out to the tail.
              allowDataOverflow
            />
            <Tooltip
              cursor={{ stroke: gold, strokeOpacity: 0.25, strokeWidth: 1 }}
              content={<BandTooltip startAge={startingPot !== undefined ? startAge : undefined} />}
              // Pin to the top-left of the plot (empty space in a rising chart)
              // rather than the default cursor-follow, which flips to awkward
              // spots near the right edge and can overflow a narrow mobile chart.
              // The cursor line + "Age N" label still mark the read point.
              position={{ x: 50, y: 12 }}
              isAnimationActive={false}
            />

            {/* Uncertainty band (p10..p90): a single barely-there fill */}
            <Area
              type="monotone"
              dataKey="outer"
              stroke="none"
              fill="url(#fanRange)"
              legendType="none"
              isAnimationActive={false}
            />

            {/* Median: the hero line with a soft gradient fill to the baseline */}
            <Area
              type="monotone"
              dataKey="p50Display"
              stroke={gold}
              strokeWidth={2.25}
              fill="url(#fanMedian)"
              dot={false}
              isAnimationActive={false}
            />

            {/* FIRE target reference line: neutral grey so the goal reads as a
                fixed marker, distinct from the gold projection, with the target
                value labelled at the right edge. */}
            {fireNumberDisplay !== undefined && fireNumberDisplay > 0 && (
              <ReferenceLine
                y={fireNumberDisplay}
                stroke={colors.text}
                strokeOpacity={0.5}
                strokeDasharray="5 4"
                label={{
                  value: `Target ${formatYAxisTick(fireNumberDisplay)}`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "#9fa3b0",
                  offset: 6,
                }}
              />
            )}

            {/* Median FIRE-age marker: a dot where the median crosses the target,
                with a short dashed drop-line to the age axis and an "Age N" label
                (the milestone ages live in their own section, not on the chart). */}
            {showFireMarker && fireNumberDisplay !== undefined && (
              <>
                <ReferenceLine
                  stroke={gold}
                  strokeOpacity={0.22}
                  strokeDasharray="3 4"
                  segment={[
                    { x: medianFireAge, y: 0 },
                    { x: medianFireAge, y: fireNumberDisplay },
                  ]}
                />
                <ReferenceDot
                  x={medianFireAge}
                  y={fireNumberDisplay}
                  r={4}
                  fill={gold}
                  stroke="#08090c"
                  strokeWidth={2}
                  label={{
                    value: `Age ${medianFireAge}`,
                    position: "top",
                    fontSize: 10,
                    fill: gold,
                    offset: 8,
                  }}
                />
              </>
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
