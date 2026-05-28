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
