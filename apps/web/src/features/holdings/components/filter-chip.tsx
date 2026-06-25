"use client";

type FilterChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export function FilterChip({ label, selected, onPress }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={label}
      aria-pressed={selected}
      className={[
        "font-mono text-xs tracking-button uppercase border border-line rounded-full px-3.5 py-[7px] transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:rounded-[inherit] whitespace-nowrap",
        selected ? "text-vault bg-accent border-accent" : "text-dim hover:text-cream",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
