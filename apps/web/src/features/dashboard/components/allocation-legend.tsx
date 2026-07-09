"use client";

import type { AllocationSlice } from "@privance/core";
import { formatCurrencyWhole, formatPercent } from "@/lib/format";

type AllocationLegendProps = {
  slices: AllocationSlice[];
  colors: string[];
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
};

export function AllocationLegend({ slices, colors, hoveredIndex, onHover }: AllocationLegendProps) {
  return (
    <ul
      // -mx-1 (with the matching width bump, since the flex parent centers
      // shrink-to-fit children) cancels the rows' px-1 so text aligns with the
      // card's other tables while the hover highlight bleeds past the text edge.
      className="grid w-[calc(100%+8px)] list-none grid-cols-[1fr_auto] gap-x-8 p-0 my-0 -mx-1 md:grid-cols-[1fr_auto_auto]"
      aria-label="Allocation legend"
    >
      {slices.map((slice, i) => {
        const color = colors[i];
        const isLast = i === slices.length - 1;
        const isActive = hoveredIndex === i;
        const isDim = hoveredIndex !== null && hoveredIndex !== i;
        return (
          <li
            key={slice.label}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            className={[
              "col-span-2 md:col-span-3 grid grid-cols-subgrid items-center px-1 py-2 text-sm rounded-[5px] transition-[background-color,opacity] duration-100 motion-reduce:transition-none",
              isLast ? "" : "border-b border-line-soft",
              isActive ? "bg-panel-2" : "",
              isDim ? "opacity-50" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <span
                className="w-[9px] h-[9px] rounded-[2px] flex-none"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span className="text-cream truncate">{slice.label}</span>
            </span>
            <span className="vfig hidden md:block font-mono text-cream tabular-nums text-right">
              {formatCurrencyWhole(slice.value)}
            </span>
            <span className="font-mono text-cream md:text-dim tabular-nums text-right">
              {formatPercent(slice.share)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
