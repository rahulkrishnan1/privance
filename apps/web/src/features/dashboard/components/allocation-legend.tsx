"use client";

import type { AllocationSlice } from "@privance/core";
import { formatPercent } from "@/lib/format";
import { assignColors } from "../palette";

type AllocationLegendProps = {
  slices: AllocationSlice[];
  hoveredIndex: number | null;
};

export function AllocationLegend({ slices, hoveredIndex }: AllocationLegendProps) {
  const colors = assignColors(slices.map((s) => s.label));
  return (
    <ul className="flex-1 min-w-[200px] list-none p-0 m-0" aria-label="Allocation legend">
      {slices.map((slice, i) => {
        const color = colors[i];
        const isLast = i === slices.length - 1;
        return (
          <li
            key={slice.label}
            className={[
              "flex items-center gap-2.5 py-2 text-[14px]",
              isLast ? "" : "border-b border-line-soft",
              hoveredIndex !== null && hoveredIndex !== i ? "opacity-50" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span
              className="w-[9px] h-[9px] rounded-[2px] flex-none"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span className="flex-1 text-cream">{slice.label}</span>
            <span className="font-mono text-[12.5px] text-cream-soft tabular-nums">
              {formatPercent(slice.share)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
