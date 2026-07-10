"use client";

type ChartColors = {
  grid: string;
  text: string;
  line: string;
  signal: string;
};

/**
 * Chart palette. The app renders dark-only (the app shell hardcodes `dark` and
 * the token palette in globals.css is unconditional), so the chart always uses
 * the dark tokens -- Signal mint `#5eead4`, not the OS-dependent value. Tying this
 * to `prefers-color-scheme` would mis-colour the chart on a light-OS machine
 * while the rest of the UI stays dark.
 */
export function useChartColors(): ChartColors {
  return {
    grid: "#22262b",
    text: "#8b939b",
    line: "#5eead4",
    signal: "#fb923c",
  };
}
