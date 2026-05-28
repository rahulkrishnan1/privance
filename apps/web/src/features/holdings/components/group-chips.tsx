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
          "inline-flex items-center justify-center rounded-full px-4 sm:px-5 h-9 sm:h-10 border text-xs sm:text-[13px] font-medium tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer whitespace-nowrap transition-colors",
          selected
            ? "bg-gold-accent/10 border-gold-accent text-gold-accent"
            : "bg-transparent border-app-line text-app-muted hover:text-app-text hover:border-app-muted/40",
        ].join(" ")}
      >
        {group.name}
      </button>
    );
  }

  return <span className="text-xs font-medium text-gold-accent truncate">{group.name}</span>;
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
