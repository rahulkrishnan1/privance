// Allocation chart palette. Order matters: chart slices are assigned colors
// in this order from largest to smallest, so the brightest hues anchor the
// dominant slices.
export const allocationPalette = [
  "#34d399", // mint
  "#3b82f6", // blue
  "#a78bfa", // lavender
  "#fb923c", // orange
  "#f87171", // coral
  "#22d3ee", // cyan
  "#facc15", // sun
  "#ec4899", // pink
  "#4ade80", // green
  "#94a3b8", // slate (fallback)
] as const;
