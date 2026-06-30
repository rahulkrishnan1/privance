"use client";

import type { Decimal } from "@privance/core";
import type { YearBand } from "@privance/core/projection";
import { useEffect, useMemo, useRef } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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
import { useMediaQuery } from "@/lib/use-media-query";

interface FanChartPoint {
  age: number;
  // Two uncertainty bands as [low, high] pairs, drawn as nested fills.
  outer: [number, number]; // p10..p90
  inner: [number, number]; // p25..p75
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

type BandTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: FanChartPoint }>;
  label?: string | number;
  startAge?: number;
  accent: string;
};

function BandTooltip({ active, payload, label, startAge, accent }: BandTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (pt === undefined) return null;
  const isToday = startAge !== undefined && pt.age === startAge;
  return (
    <div className="rounded-lg border border-line bg-panel-2/95 px-3 py-2.5 text-xs shadow-lg shadow-black/30 backdrop-blur-sm">
      <p className="mb-2 font-mono text-xs uppercase tracking-label text-dim">
        {isToday ? "Today" : `Age ${label}`}
      </p>
      <div className="flex items-center justify-between gap-5">
        <span className="flex items-center gap-2 text-cream">
          <span className="h-px w-3" style={{ background: accent }} />
          Median
        </span>
        <span className="vfig font-semibold tabular-nums text-cream">
          {formatCurrencyWhole(pt.p50)}
        </span>
      </div>
      {!isToday && (
        <>
          <div className="mt-2 flex items-center justify-between gap-5 text-cream-soft">
            <span>Middle 50%</span>
            <span className="vfig tabular-nums">
              {formatCurrencyCompact(pt.p25)} to {formatCurrencyCompact(pt.p75)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-5 text-cream-soft">
            <span>Middle 80%</span>
            <span className="vfig tabular-nums">
              {formatCurrencyCompact(pt.p10)} to {formatCurrencyCompact(pt.p90)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

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
  /** Calendar year the median crosses FI; labels the crossing marker. */
  fireYear?: number;
  /** Plan-until age; medianFireAge === planUntilAge is the never-reached sentinel. */
  planUntilAge?: number;
};

/**
 * Projection chart. A confident teal median line is the hero over two nested
 * uncertainty bands (p25..p75 and p10..p90). The FI number reads as a fixed
 * signal-orange marker the median rises to cross. The line originates at the
 * starting portfolio ("today"). Float values live only at the display boundary;
 * Decimal originals are kept for the tooltip.
 */
export function FanChart({
  bands,
  startAge,
  className,
  fireNumberDisplay,
  startingPot,
  medianFireAge,
  fireYear,
  planUntilAge,
}: FanChartProps) {
  const colors = useChartColors();
  const accent = colors.line;
  const signal = colors.signal;

  // Animate the entry like the Invest chart, but only on first paint: this chart
  // recomputes on every lever move, and re-animating each settle would be janky.
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const firstPaintRef = useRef(true);
  const animate = !reducedMotion && firstPaintRef.current;
  useEffect(() => {
    firstPaintRef.current = false;
  }, []);

  const chartData = useMemo<FanChartPoint[]>(() => {
    const points: FanChartPoint[] = [];
    // Origin: today's value. All percentiles share it, so the cone fans out
    // from the starting portfolio instead of starting a year in.
    if (startingPot !== undefined) {
      const v = startingPot.toFloat();
      points.push({
        age: startAge,
        outer: [v, v],
        inner: [v, v],
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
        inner: [b.p25.toFloat(), b.p75.toFloat()],
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
        className={["flex min-h-[224px] items-center justify-center", className]
          .filter(Boolean)
          .join(" ")}
      >
        <p className="text-sm text-dim">Not enough data to render the chart.</p>
      </div>
    );
  }

  return (
    <div className={["relative", className].filter(Boolean).join(" ")}>
      {/* Fixed height: ResponsiveContainer's height="100%" cannot resolve
          against a flex-1 min-h parent (renders 0-high in the real app).
          Shorter on phones so the whole chart, including the age axis, fits the
          viewport above the bottom nav. */}
      <div className="relative h-64 md:h-80" role="img" aria-label="Projection fan chart">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 320 }}
        >
          {/* Small left margin so the first Age tick has room now that the dollar
              scale (and its old gutter) moved to the right edge. */}
          <AreaChart data={chartData} margin={{ top: 16, right: 12, bottom: 8, left: 12 }}>
            <defs>
              {/* Whisper-faint outer band (p10..p90) */}
              <linearGradient id="fanOuter" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.1} />
                <stop offset="100%" stopColor={accent} stopOpacity={0.03} />
              </linearGradient>
              {/* Stronger inner band (p25..p75): the likely range */}
              <linearGradient id="fanInner" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent} stopOpacity={0.22} />
                <stop offset="100%" stopColor={accent} stopOpacity={0.08} />
              </linearGradient>
            </defs>
            {/* Barely-there horizontal rules; the dollar labels at the right edge
                carry the scale and keep the plot airy. */}
            <CartesianGrid vertical={false} stroke="rgba(235,235,230,0.05)" strokeWidth={1} />
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
              // Dollar ticks render as a veil-able HTML overlay (below); SVG <text>
              // can't receive the Veil blur. Axis hidden but kept for the gridlines.
              hide
              width={0}
              domain={yDomain}
              ticks={yTicks}
              // Respect the median-scaled domain and clip the p90 band at the top
              // instead of expanding the axis back out to the tail.
              allowDataOverflow
            />
            <Tooltip
              cursor={{ stroke: accent, strokeOpacity: 0.25, strokeWidth: 1 }}
              content={
                <BandTooltip
                  startAge={startingPot !== undefined ? startAge : undefined}
                  accent={accent}
                />
              }
              // Pinned flush top-left (empty space in a rising chart) rather than
              // cursor-following, which can overflow a narrow mobile chart; the
              // cursor line + "Age N" label still mark the read point.
              position={{ x: 0, y: 12 }}
              isAnimationActive={false}
            />

            {/* Outer band (p10..p90) */}
            <Area
              type="monotone"
              dataKey="outer"
              stroke="none"
              fill="url(#fanOuter)"
              legendType="none"
              isAnimationActive={animate}
              animationDuration={1400}
            />

            {/* Inner band (p25..p75): the likely range */}
            <Area
              type="monotone"
              dataKey="inner"
              stroke="none"
              fill="url(#fanInner)"
              legendType="none"
              isAnimationActive={animate}
              animationDuration={1400}
            />

            {/* Median: the hero line, no fill (the bands carry the shading) */}
            <Area
              type="monotone"
              dataKey="p50Display"
              stroke={accent}
              strokeWidth={2.2}
              fill="none"
              dot={false}
              isAnimationActive={animate}
              animationDuration={1400}
            />

            {/* FIRE target reference line: signal orange so the goal reads as a
                fixed marker the median rises to cross. */}
            {fireNumberDisplay !== undefined && fireNumberDisplay > 0 && (
              <ReferenceLine
                y={fireNumberDisplay}
                stroke={signal}
                strokeOpacity={0.7}
                strokeDasharray="5 5"
              />
            )}

            {/* Median FIRE-age marker: a signal dot where the median crosses the
                target, a short faint drop-line to the age axis, and a "FI · YEAR"
                label (the milestone ages live in their own section). */}
            {showFireMarker && fireNumberDisplay !== undefined && (
              <>
                <ReferenceLine
                  stroke="rgba(235,235,230,0.14)"
                  strokeDasharray="2 4"
                  segment={[
                    { x: medianFireAge, y: 0 },
                    { x: medianFireAge, y: fireNumberDisplay },
                  ]}
                />
                <ReferenceDot
                  x={medianFireAge}
                  y={fireNumberDisplay}
                  r={5}
                  fill={signal}
                  stroke="#0e0f11"
                  strokeWidth={2}
                  label={{
                    value: fireYear !== undefined ? `FI · ${fireYear}` : "FI",
                    position: "top",
                    fontSize: 9.5,
                    fill: signal,
                    offset: 8,
                  }}
                />
              </>
            )}
          </AreaChart>
        </ResponsiveContainer>

        {/* Dollar scale as veil-able HTML in the plot's right edge. Insets mirror the
            chart margins to stay aligned: top-4=top(16), right-3=right(12), bottom-12=xAxis(40)+bottom(8). */}
        <div className="pointer-events-none absolute top-4 right-3 bottom-12 flex flex-col items-end justify-between">
          {[...yTicks].reverse().map((v, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional tick scale
              key={i}
              className="vfig bg-vault px-1 font-mono text-xs text-faint"
            >
              {formatYAxisTick(v)}
            </span>
          ))}
        </div>
      </div>

      {/* Legend below the chart, four items echoing the mock. */}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs uppercase tracking-label text-faint">
        <span className="flex items-center gap-2">
          <span className="inline-block h-[3px] w-4 rounded-sm" style={{ background: accent }} />
          Median path
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-[3px] w-4 rounded-sm"
            style={{ background: "rgba(127,196,198,0.3)" }}
          />
          Likely range (25 to 75)
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-[3px] w-4 rounded-sm"
            style={{ background: "rgba(127,196,198,0.12)" }}
          />
          Possible range (10 to 90)
        </span>
        {fireNumberDisplay !== undefined && fireNumberDisplay > 0 && (
          <span className="flex items-center gap-2">
            <span className="inline-block h-px w-4" style={{ background: signal }} />
            FI number:{" "}
            <span className="vfig text-cream-soft">{formatYAxisTick(fireNumberDisplay)}</span>
          </span>
        )}
      </div>

      {/* Screen-reader equivalent: median + p10-p90 by year. sr-only must sit on a
          wrapping div, not the table (a table ignores width/height:1px and overflows). */}
      <div className="sr-only">
        <table>
          <caption>Projected portfolio by age: median with 10th to 90th percentile range.</caption>
          <thead>
            <tr>
              <th>Age</th>
              <th>Median</th>
              <th>10th percentile</th>
              <th>90th percentile</th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((d) => (
              <tr key={d.age}>
                <td>{d.age}</td>
                <td>{formatCurrencyWhole(d.p50)}</td>
                <td>{formatCurrencyWhole(d.p10)}</td>
                <td>{formatCurrencyWhole(d.p90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
