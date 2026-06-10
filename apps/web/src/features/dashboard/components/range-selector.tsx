"use client";

import { useEffect, useRef } from "react";
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
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // The row scrolls horizontally on narrow screens; keep the selected option visible.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on selection change
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [selected]);

  return (
    // Horizontal scroll instead of wrapping so options never drop onto a second row.
    <div className="flex gap-1 overflow-x-auto">
      {RANGES.map((range) => {
        const isSelected = range === selected;
        return (
          <button
            key={range}
            ref={isSelected ? selectedRef : undefined}
            type="button"
            onClick={() => onChange(range)}
            aria-pressed={isSelected}
            aria-label={`${range} range`}
            className={[
              "shrink-0 whitespace-nowrap px-3 py-1.5 min-h-[44px] sm:min-h-0 items-center rounded-full text-xs font-medium tracking-tight border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer transition-colors",
              isSelected
                ? "bg-gold-accent/10 border-gold-accent text-gold-accent"
                : "border-app-line text-app-muted hover:text-app-text hover:border-app-muted/40",
            ].join(" ")}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
