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
        "inline-flex items-center justify-center rounded-full px-4 sm:px-5 h-9 sm:h-10 border text-xs sm:text-[13px] font-medium tracking-tight whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer transition-colors",
        selected
          ? "bg-gold-accent/10 border-gold-accent text-gold-accent"
          : "bg-transparent border-app-line text-app-muted hover:text-app-text hover:border-app-muted/40",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
