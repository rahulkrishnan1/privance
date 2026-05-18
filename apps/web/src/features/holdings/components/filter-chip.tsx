"use client";

type FilterChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

/** Single source of styling for filter chips on the holdings screen. */
export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      aria-pressed={selected}
      className={[
        "inline-flex items-center justify-center rounded-full px-3 h-9 border text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none cursor-pointer transition-colors",
        selected
          ? "bg-gold-600 border-gold-600 text-white"
          : "bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
