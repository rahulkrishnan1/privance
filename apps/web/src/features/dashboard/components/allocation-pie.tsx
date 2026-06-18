"use client";

import { type AllocationSlice, Decimal, SCALE_CENTS } from "@privance/core";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatCurrencyCompact } from "@/lib/format";
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

const MODE_LABEL: Record<AllocationMode, string> = {
  class: "By class",
  sector: "By sector",
};

const CENTER_LABEL: Record<AllocationMode, string> = {
  class: "invested + cash",
  sector: "by sector",
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

  const colors = assignColors(slices.map((s) => s.label));

  const total = slices.reduce(
    (acc, s) => acc.add(s.value.isNegative() ? Decimal.zero(SCALE_CENTS) : s.value),
    Decimal.zero(SCALE_CENTS),
  );

  return (
    <div
      className="bg-panel border border-line rounded-[10px] p-6 h-full"
      role="img"
      aria-label={`${title} allocation chart`}
    >
      <div className="flex justify-between items-baseline mb-4 flex-wrap gap-x-3 gap-y-1">
        <h3 className="font-serif text-[20px] font-normal tracking-[-0.005em]">{title}</h3>
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "class" ? "sector" : "class"));
            setHoveredIndex(null);
          }}
          aria-label={`Switch allocation view (currently ${MODE_LABEL[mode]})`}
          className="font-mono text-[10px] tracking-[.14em] uppercase text-faint hover:text-accent transition-colors cursor-pointer"
        >
          {MODE_LABEL[mode]} <span aria-hidden="true">&#9662;</span>
        </button>
      </div>

      {isEmpty ? (
        <p className="text-sm text-dim text-center py-8">Add holdings to see allocation</p>
      ) : (
        <div className="flex gap-7 items-center flex-wrap justify-center">
          {/* Donut, 168x168 fixed, center label absolutely positioned */}
          <div className="relative w-[168px] h-[168px] flex-none">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={{ width: 168, height: 168 }}
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
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="vfig font-serif text-[24px]">{formatCurrencyCompact(total)}</span>
              <span className="font-mono text-[8.5px] tracking-[.18em] uppercase text-faint mt-[3px]">
                {CENTER_LABEL[mode]}
              </span>
            </div>
          </div>

          <AllocationLegend slices={slices} hoveredIndex={hoveredIndex} />
        </div>
      )}
    </div>
  );
}
