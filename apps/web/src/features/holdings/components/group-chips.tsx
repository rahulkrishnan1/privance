"use client";

import type { LocalGroup } from "../types";

type GroupChipProps = {
  group: LocalGroup;
  onPress?: () => void;
  selected?: boolean;
};

export function GroupChip({ group, onPress, selected = false }: GroupChipProps) {
  if (onPress !== undefined) {
    return (
      <button
        type="button"
        onClick={onPress}
        aria-label={group.name}
        aria-pressed={selected}
        className={[
          "inline-flex items-center justify-center rounded-full px-3 h-8 border text-xs font-medium focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none cursor-pointer whitespace-nowrap",
          selected
            ? "bg-gold-600 border-gold-600 text-white"
            : "bg-gold-50 dark:bg-gold-950 border-gold-200 dark:border-gold-800 text-gold-700 dark:text-gold-300 hover:bg-gold-100 dark:hover:bg-gold-900",
        ].join(" ")}
      >
        {group.name}
      </button>
    );
  }

  return (
    <span className="text-xs font-medium text-gold-700 dark:text-gold-300 truncate">
      {group.name}
    </span>
  );
}

type GroupChipsRowProps = {
  groups: LocalGroup[];
  onRemove?: (groupId: string) => void;
};

export function GroupChipsRow({ groups, onRemove }: GroupChipsRowProps) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {groups.map((g) => (
        <GroupChip
          key={g.id}
          group={g}
          {...(onRemove !== undefined ? { onPress: () => onRemove(g.id) } : {})}
        />
      ))}
    </div>
  );
}
