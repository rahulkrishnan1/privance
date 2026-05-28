"use client";

import type { Decimal, NetWorthBreakdown } from "@privance/core";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { formatCurrencyParts } from "@/lib/format";
import type { HistoryPoint } from "../types";
import { DeltaLine } from "./delta-line";

type NetWorthTileProps = {
  breakdown: NetWorthBreakdown;
  historyPoints: HistoryPoint[];
  /** Today's delta against prior session, derived from per-holding prev prices. */
  delta: { dollar: Decimal; pct: number } | null;
};

export function NetWorthTile({ breakdown, historyPoints, delta }: NetWorthTileProps) {
  const { whole, cents } = formatCurrencyParts(breakdown.netWorth);
  const sparkData = historyPoints.slice(-60).map((p) => ({ v: p.valueDisplay }));

  return (
    <div className="rounded-xl border border-app-line bg-app-panel p-5 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">Net worth</p>
        {sparkData.length > 1 && (
          <div
            style={{ width: 110, height: 36 }}
            role="img"
            aria-label="60-day net worth sparkline"
            className="shrink-0"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="#e6d39a"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <p className="font-editorial font-normal tracking-[-0.02em] text-app-text leading-none">
        <span className="text-[40px] sm:text-[44px]">{whole}</span>
        <span className="text-[26px] sm:text-[28px] text-app-dim">{cents}</span>
      </p>

      <div className="h-4">{delta !== null && <DeltaLine {...delta} />}</div>
    </div>
  );
}
