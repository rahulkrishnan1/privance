// Allocation chart palette. Two color families only: warm gold and cool slate.
// Alternates between them so neighbouring slices stay distinct. Order is
// largest-to-smallest by slice value, so the brightest tones anchor the
// dominant slices.
export const allocationPalette = [
  "#e6d39a", // gold-accent (brand, primary)
  "#9ba5b8", // cool slate
  "#c4b18a", // lighter gold
  "#6e7a91", // muted slate
  "#a39378", // dim gold
  "#525c70", // deep slate
  "#867963", // dark gold
  "#7c8597", // pale slate
  "#5d5648", // graphite gold
  "#41485a", // ink slate (fallback)
] as const;

// Defensive fallbacks. The palette is non-empty so these almost never render;
// they exist to satisfy the type checker on indexed access.
export const PALETTE_FALLBACK_GRAY = "#6b7280";
// Empty-state fill: subtle dark-surface tone consistent with the app line tokens.
export const EMPTY_PIE_FILL = "rgba(255,255,255,0.08)";
