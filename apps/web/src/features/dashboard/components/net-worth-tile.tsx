"use client";

import type { Decimal, NetWorthBreakdown } from "@privance/core";
import { formatCurrencyParts } from "@/lib/format";
import { DeltaLine } from "./delta-line";

type NetWorthTileProps = {
  breakdown: NetWorthBreakdown;
  /** Today's delta against prior session, derived from per-holding prev prices. */
  delta: { dollar: Decimal; pct: number } | null;
};

export function NetWorthTile({ breakdown, delta }: NetWorthTileProps) {
  const { whole, cents } = formatCurrencyParts(breakdown.netWorth);

  return (
    <div className="rounded-xl border border-app-line bg-app-panel p-5 flex flex-col gap-5">
      <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">Net worth</p>

      <p
        data-testid="net-worth-value"
        className="font-editorial font-normal tracking-[-0.02em] text-app-text leading-none"
      >
        <span className="text-[40px] sm:text-[44px]">{whole}</span>
        <span className="text-[26px] sm:text-[28px] text-app-dim">{cents}</span>
      </p>

      <div className="h-4">{delta !== null && <DeltaLine {...delta} />}</div>
    </div>
  );
}
