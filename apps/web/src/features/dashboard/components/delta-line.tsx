"use client";

import type { Decimal } from "@privance/core";
import { formatCurrency, formatPercent } from "@/lib/format";

type DeltaLineProps = {
  dollar: Decimal;
  pct: number;
};

/** Mono subline used by KPI tiles to show a signed dollar + percent today-change. */
export function DeltaLine({ dollar, pct }: DeltaLineProps) {
  const positive = !dollar.isNegative() && !dollar.isZero();
  const zero = dollar.isZero();
  return (
    <span
      className={[
        "font-mono text-[12px] tabular-nums tracking-tight",
        zero ? "text-app-muted" : positive ? "text-app-green" : "text-app-red",
      ].join(" ")}
    >
      {positive ? "+ " : zero ? "" : "- "}
      {formatCurrency(zero ? dollar : dollar.abs())} ({formatPercent(pct, { signed: true })}) today
    </span>
  );
}
