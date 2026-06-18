// One ordered palette applied by slice rank (largest first). The color in a
// given position is identical across the allocation donut (class + sector) and
// the "Where it lives" bar, so the three views share one color order.
export const allocationPalette = [
  "#7fc4c6", // teal (brand)
  "#c9a86b", // gold
  "#c8551f", // clay
  "#4f898c", // teal-dim
  "#8e9bc4", // slate-blue
  "#b0879b", // mauve
  "#9bb0a6", // sage
  "#5e7e80", // deep teal-gray
  "#c7c5bc", // cream-soft
] as const;

// Defensive fallback. The palette is non-empty so this almost never renders.
export const PALETTE_FALLBACK_GRAY = "#6b7280";

/** Colors for a value-ordered slice list: rank N always gets palette position N. */
export function assignColors(labels: readonly string[]): string[] {
  return labels.map(
    (_, i) => allocationPalette[i % allocationPalette.length] ?? PALETTE_FALLBACK_GRAY,
  );
}
