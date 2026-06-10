"use client";

export type ChartColors = {
  grid: string;
  text: string;
  line: string;
};

/**
 * Chart palette. The app renders dark-only (the app shell hardcodes `dark` and
 * the token palette in globals.css is unconditional), so the chart always uses
 * the dark tokens -- gold `#e6d39a`, not the OS-dependent value. Tying this to
 * `prefers-color-scheme` would mis-colour the chart on a light-OS machine while
 * the rest of the UI stays dark.
 */
export function useChartColors(): ChartColors {
  return {
    grid: "#262626",
    text: "#a3a3a3",
    line: "#e6d39a",
  };
}
