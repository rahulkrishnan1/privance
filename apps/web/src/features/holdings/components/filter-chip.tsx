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
        "inline-flex items-center justify-center rounded-full px-3 h-9 border text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:ring-gold-accent/40 focus-visible:outline-none cursor-pointer transition-colors",
        selected
          ? "bg-gold-600 border-gold-600 text-white"
          : "bg-app-panel border-app-line text-app-text hover:bg-white/[0.03]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
