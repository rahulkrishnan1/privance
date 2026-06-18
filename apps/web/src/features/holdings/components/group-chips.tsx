"use client";

import type { LocalGroup } from "../types";

type GroupChipProps = {
  group: LocalGroup;
  onPress: () => void;
  selected?: boolean;
};

export function GroupChip({ group, onPress, selected = false }: GroupChipProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={group.name}
      aria-pressed={selected}
      className={[
        "inline-flex items-center justify-center rounded-full px-4 sm:px-5 h-9 sm:h-10 border text-xs sm:text-[13px] font-medium tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:rounded-[inherit] cursor-pointer whitespace-nowrap transition-colors",
        selected
          ? "bg-accent/10 border-accent text-accent"
          : "bg-transparent border-line text-cream-soft hover:text-cream hover:border-cream-soft/40",
      ].join(" ")}
    >
      {group.name}
    </button>
  );
}
