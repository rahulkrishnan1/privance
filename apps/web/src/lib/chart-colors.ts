"use client";

export type ChartColors = {
  grid: string;
  text: string;
  line: string;
  signal: string;
};

/**
 * Chart palette. The app renders dark-only (the app shell hardcodes `dark` and
 * the token palette in globals.css is unconditional), so the chart always uses
 * the dark tokens -- Tide teal `#7fc4c6`, not the OS-dependent value. Tying this
 * to `prefers-color-scheme` would mis-colour the chart on a light-OS machine
 * while the rest of the UI stays dark.
 */
export function useChartColors(): ChartColors {
  return {
    grid: "#262626",
    text: "#8e8e88",
    line: "#7fc4c6",
    signal: "#c8551f",
  };
}
