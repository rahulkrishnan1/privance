"use client";

import type { AllocationSlice } from "@privance/core";
import { formatCurrency, formatPercent } from "@/lib/format";
import { allocationPalette } from "../palette";

type AllocationLegendProps = {
  slices: AllocationSlice[];
  hoveredIndex: number | null;
};

/**
 * Row-based legend for an allocation pie chart.
 * Highlights the row corresponding to the hovered slice.
 */
export function AllocationLegend({ slices, hoveredIndex }: AllocationLegendProps) {
  return (
    <ul className="mt-3 flex flex-col gap-1.5 list-none p-0 m-0" aria-label="Allocation legend">
      {slices.map((slice, i) => {
        const color = allocationPalette[i % allocationPalette.length] ?? "#6b7280";
        const isHovered = hoveredIndex === i;
        return (
          <li
            key={slice.label}
            className={[
              "flex items-center justify-between py-1 px-2 rounded-lg",
              isHovered ? "bg-neutral-100 dark:bg-neutral-800" : "",
            ].join(" ")}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div
                className="w-3 h-3 rounded-sm shrink-0"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span className="text-sm text-neutral-700 dark:text-neutral-300 truncate">
                {slice.label}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
                {formatPercent(slice.share)}
              </span>
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50 tabular-nums">
                {formatCurrency(slice.value)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
