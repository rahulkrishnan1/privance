"use client";

import { type AllocationSlice, Decimal, SCALE_CENTS } from "@privance/core";
import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/format";
import { allocationPalette } from "../palette";
import { AllocationLegend } from "./allocation-legend";

type AllocationPieProps = {
  title: string;
  slices: AllocationSlice[];
};

type PieEntry = {
  name: string;
  value: number;
  index: number;
};

/**
 * A single donut chart with a custom legend below.
 */
export function AllocationPie({ title, slices }: AllocationPieProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const isEmpty = slices.length === 0;

  const data: PieEntry[] = slices.map((s, i) => {
    const safeValue = s.value.isNegative() ? Decimal.zero(SCALE_CENTS) : s.value;
    return { name: s.label, value: safeValue.toFloat(), index: i };
  });

  const total = slices.reduce(
    (acc, s) => acc.add(s.value.isNegative() ? Decimal.zero(SCALE_CENTS) : s.value),
    Decimal.zero(SCALE_CENTS),
  );

  return (
    <div
      className="flex-1 rounded-xl border border-app-line bg-app-panel p-4"
      role="img"
      aria-label={`${title} allocation chart`}
    >
      <p className="text-sm font-semibold text-app-text mb-3">{title}</p>

      <div style={{ height: 240 }}>
        {isEmpty ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{ name: "empty", value: 1 }]}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="90%"
                isAnimationActive={false}
              >
                <Cell fill="#e5e7eb" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="90%"
                paddingAngle={1}
                isAnimationActive={false}
                onMouseEnter={(_entry, index) => {
                  setHoveredIndex(index);
                }}
                onMouseLeave={() => {
                  setHoveredIndex(null);
                }}
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={allocationPalette[entry.index % allocationPalette.length] ?? "#6b7280"}
                    opacity={hoveredIndex === null || hoveredIndex === entry.index ? 1 : 0.5}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {isEmpty ? (
        <p className="text-xs text-app-muted text-center mt-2">Add holdings to see allocation</p>
      ) : (
        <>
          <p className="text-xs text-app-muted text-center mt-1">Total: {formatCurrency(total)}</p>
          <AllocationLegend slices={slices} hoveredIndex={hoveredIndex} />
        </>
      )}
    </div>
  );
}
