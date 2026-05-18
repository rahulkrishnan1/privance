import type { Decimal } from "@privance/core";

/** A single data point for the net worth history chart. */
export interface HistoryPoint {
  /** ISO date string YYYY-MM-DD. */
  date: string;
  /** Net worth in major units as a number (display only, arithmetic uses Decimal). */
  valueDisplay: number;
  /** Raw Decimal value for tooltip formatting. */
  value: Decimal;
}

/** Range options for the history chart segmented control. */
export type ChartRange = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "All";

/** A processed slice for the allocation pie legend. */
export interface LegendSlice {
  label: string;
  color: string;
  formattedValue: string;
  formattedPercent: string;
  /** Index among the pie slices (used for hover state). */
  index: number;
}
