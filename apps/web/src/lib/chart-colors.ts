type ChartColors = {
  grid: string;
  text: string;
  line: string;
  signal: string;
};

export function useChartColors(): ChartColors {
  return {
    grid: "var(--color-line-soft)",
    text: "var(--color-dim)",
    line: "var(--color-accent)",
    signal: "var(--color-signal)",
  };
}
