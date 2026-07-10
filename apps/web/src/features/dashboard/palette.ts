// One ordered palette applied by slice rank (largest first). The color in a
// given position is identical across the allocation donut (class + sector) and
// the "Where it lives" bar, so the three views share one color order.
const allocationPalette = [
  "#5eead4", // mint (brand)
  "#a78bfa", // violet
  "#fbbf24", // amber
  "#7dd3fc", // sky
  "#f0abfc", // orchid
  "#86efac", // green
  "#fdba74", // soft orange
  "#67e8f9", // cyan
  "#f9a8d4", // rose-pink
  "#d9f99d", // lime
  "#c4b5fd", // lavender
  "#94a3b8", // slate
  "#fde68a", // pale yellow
  "#c9ced2", // cream-soft
] as const;

// Defensive fallback. The palette is non-empty so this almost never renders.
export const PALETTE_FALLBACK_GRAY = "#6b7280";

/** Colors for a value-ordered slice list: rank N always gets palette position N. */
export function assignColors(labels: readonly string[]): string[] {
  return labels.map(
    (_, i) => allocationPalette[i % allocationPalette.length] ?? PALETTE_FALLBACK_GRAY,
  );
}
