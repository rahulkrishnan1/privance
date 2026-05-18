"use client";

import { useEffect, useState } from "react";

export type ChartColors = {
  grid: string;
  text: string;
  line: string;
};

export function useChartColors(): ChartColors {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains("dark"));
    update();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return {
    grid: isDark ? "#262626" : "#e5e7eb",
    text: isDark ? "#a3a3a3" : "#6b7280",
    line: isDark ? "#10b981" : "#b18a1c",
  };
}
