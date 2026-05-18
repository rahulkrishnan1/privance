"use client";

import type { ChartRange } from "../types";

const RANGES: ChartRange[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "All"];

type RangeSelectorProps = {
  selected: ChartRange;
  onChange: (range: ChartRange) => void;
};

/**
 * Horizontal segmented control for selecting the history chart date range.
 */
export function RangeSelector({ selected, onChange }: RangeSelectorProps) {
  return (
    <div className="flex gap-1">
      {RANGES.map((range) => {
        const isSelected = range === selected;
        return (
          <button
            key={range}
            type="button"
            onClick={() => onChange(range)}
            aria-pressed={isSelected}
            aria-label={`${range} range`}
            className={[
              "px-3 py-1.5 rounded-lg text-sm font-medium focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none cursor-pointer",
              isSelected
                ? "bg-gold-600 text-white border border-gold-600"
                : "border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800",
            ].join(" ")}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
