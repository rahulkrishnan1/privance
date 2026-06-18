"use client";

import { useEffect, useRef } from "react";
import type { ChartRange } from "../types";

type RangeSelectorProps = {
  selected: ChartRange;
  onChange: (range: ChartRange) => void;
  ranges: ChartRange[];
};

/**
 * Minimal text range buttons for the history chart. The active range reads as a
 * filled chip; the rest are quiet until hover.
 */
export function RangeSelector({ selected, onChange, ranges }: RangeSelectorProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // The row scrolls horizontally on narrow screens; keep the selected option visible.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on selection change
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [selected]);

  return (
    <div className="flex gap-0.5 overflow-x-auto">
      {ranges.map((range) => {
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
              "shrink-0 whitespace-nowrap rounded-[5px] px-3 py-[7px] font-mono text-[10.5px] tracking-[.1em] cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:rounded-[inherit]",
              isSelected ? "text-cream bg-panel-2" : "text-faint hover:text-cream-soft",
            ].join(" ")}
          >
            {range}
          </button>
        );
      })}
    </div>
  );
}
