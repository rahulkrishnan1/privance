"use client";

import { useEffect, useRef } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
    <ToggleGroup
      type="single"
      value={selected}
      onValueChange={(nv) => nv && onChange(nv as ChartRange)}
      aria-label="Chart range"
      className="flex gap-0.5 overflow-x-auto"
    >
      {ranges.map((range) => (
        <ToggleGroupItem
          key={range}
          value={range}
          size="sm"
          ref={range === selected ? selectedRef : undefined}
          aria-label={`${range} range`}
          className="shrink-0 whitespace-nowrap rounded-[5px] px-3 py-[7px]"
        >
          {range}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
