"use client";

import { type AllocationSlice, Decimal, SCALE_CENTS } from "@privance/core";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatCurrencyCompact, formatPercent } from "@/lib/format";
import { assignColors, PALETTE_FALLBACK_GRAY } from "../palette";
import { AllocationLegend } from "./allocation-legend";

type AllocationMode = "class" | "sector";

type AllocationPieProps = {
  title: string;
  classSlices: AllocationSlice[];
  sectorSlices: AllocationSlice[];
};

type PieEntry = {
  name: string;
  value: number;
  index: number;
};

const MODES: { value: AllocationMode; label: string }[] = [
  { value: "class", label: "Class" },
  { value: "sector", label: "Sector" },
];

const REST_LABEL: Record<AllocationMode, string> = {
  class: "Total",
  sector: "Invested",
};

export function AllocationPie({ title, classSlices, sectorSlices }: AllocationPieProps) {
  const [mode, setMode] = useState<AllocationMode>("class");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const slices = mode === "class" ? classSlices : sectorSlices;
  const isEmpty = slices.length === 0;

  const data: PieEntry[] = slices.map((s, i) => {
    const safeValue = s.value.isNegative() ? Decimal.zero(SCALE_CENTS) : s.value;
    return { name: s.label, value: safeValue.toFloat(), index: i };
  });

  const colors = useMemo(() => assignColors(slices.map((s) => s.label)), [slices]);

  const total = slices.reduce(
    (acc, s) => acc.add(s.value.isNegative() ? Decimal.zero(SCALE_CENTS) : s.value),
    Decimal.zero(SCALE_CENTS),
  );

  const hovered = hoveredIndex !== null ? slices[hoveredIndex] : null;
  const centerLabel = hovered ? hovered.label : REST_LABEL[mode];
  const centerValue = hovered ? hovered.value : total;
  const centerPct = hovered ? formatPercent(hovered.share) : "";

  return (
    <div
      className="bg-panel border border-line rounded-[10px] p-6 h-full"
      role="img"
      aria-label={`${title} allocation chart`}
    >
      <div className="flex justify-between items-baseline mb-4 flex-wrap gap-x-3 gap-y-1">
        <h3 className="font-serif text-2xl font-normal tracking-[-0.005em]">{title}</h3>
        <div className="inline-flex rounded-full border border-line bg-panel-2 p-[3px]">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                setMode(m.value);
                setHoveredIndex(null);
              }}
              aria-pressed={mode === m.value}
              className={[
                "rounded-full px-3 py-1 font-mono text-[11px] tracking-button uppercase transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                mode === m.value ? "bg-cream text-vault" : "text-dim hover:text-cream",
              ].join(" ")}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {isEmpty ? (
        <p className="text-sm text-dim text-center py-8">Add holdings to see allocation</p>
      ) : (
        <div className="flex flex-col items-center gap-[18px]">
          {/* Donut on top, center label/figure/pct swap to the hovered slice */}
          <div className="relative w-full max-w-[228px] aspect-square">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 228, height: 228 }}
            >
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="76%"
                  outerRadius="96%"
                  paddingAngle={0}
                  stroke="none"
                  isAnimationActive={false}
                  onMouseEnter={(_entry, index) => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={colors[entry.index] ?? PALETTE_FALLBACK_GRAY}
                      opacity={hoveredIndex === null || hoveredIndex === entry.index ? 1 : 0.5}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6 text-center">
              {/* Cap the width below the ring's inner chord so long names wrap to
                  two balanced lines instead of one line spilling onto the ring. */}
              <span className="font-mono text-xs tracking-[0.12em] uppercase text-faint max-w-[130px] text-balance leading-[1.15]">
                {centerLabel}
              </span>
              <span className="vfig font-serif text-4xl leading-none mt-1">
                {formatCurrencyCompact(centerValue)}
              </span>
              <span className="font-mono text-xs text-accent mt-[3px] min-h-[1em]">
                {centerPct}
              </span>
            </div>
          </div>

          <AllocationLegend
            slices={slices}
            colors={colors}
            hoveredIndex={hoveredIndex}
            onHover={setHoveredIndex}
          />
        </div>
      )}
    </div>
  );
}
