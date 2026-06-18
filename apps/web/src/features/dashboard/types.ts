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
export type ChartRange = "1M" | "3M" | "1Y" | "5Y" | "All";
