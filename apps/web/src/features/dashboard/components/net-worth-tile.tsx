"use client";

import type { Decimal, NetWorthBreakdown } from "@privance/core";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { RefreshButton } from "@/components/index";
import { formatCurrency, formatPercent, formatTime } from "@/lib/format";
import type { HistoryPoint } from "../types";

type NetWorthTileProps = {
  breakdown: NetWorthBreakdown;
  historyPoints: HistoryPoint[];
  lastRefreshedMs: number;
  cooldownMs: number;
  onRefresh: () => void;
  refreshing: boolean;
};

function buildDelta(
  current: Decimal,
  historyPoints: HistoryPoint[],
): { dollar: Decimal; pct: number } | null {
  if (historyPoints.length === 0) return null;
  const previous = historyPoints[historyPoints.length - 1]?.value;
  if (previous === undefined) return null;
  const dollar = current.sub(previous);
  if (previous.isZero()) return null;
  const pct = dollar.toFloat() / previous.toFloat();
  return { dollar, pct };
}

/**
 * Full-width tile showing current net worth, today's delta, a sparkline,
 * and a refresh button.
 */
export function NetWorthTile({
  breakdown,
  historyPoints,
  lastRefreshedMs,
  cooldownMs,
  onRefresh,
  refreshing,
}: NetWorthTileProps) {
  const delta = buildDelta(breakdown.netWorth, historyPoints);

  const deltaPositive = delta !== null && !delta.dollar.isNegative() && !delta.dollar.isZero();
  const deltaZero = delta === null || delta.dollar.isZero();

  const sparkData = historyPoints.slice(-60).map((p) => ({
    v: p.valueDisplay,
  }));

  return (
    <div className="rounded-xl border border-app-line bg-app-panel p-4 mb-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-app-muted">Last refreshed: {formatTime(lastRefreshedMs)}</p>
        <RefreshButton cooldownMs={cooldownMs} onRefresh={onRefresh} refreshing={refreshing} />
      </div>

      {/* Net worth + sparkline */}
      <div className="flex items-start justify-between">
        <div className="flex-1 mr-4">
          <p className="font-editorial text-[44px] font-normal tracking-[-0.02em] text-app-text leading-none">
            {formatCurrency(breakdown.netWorth)}
          </p>

          {/* Delta row */}
          {delta !== null ? (
            <div className="flex items-center gap-1.5 mt-2">
              {deltaPositive ? (
                <TrendingUp size={16} className="text-app-green" />
              ) : deltaZero ? null : (
                <TrendingDown size={16} className="text-app-red" />
              )}
              <span
                className={[
                  "text-sm tabular-nums font-medium",
                  deltaZero ? "text-app-muted" : deltaPositive ? "text-app-green" : "text-app-red",
                ].join(" ")}
              >
                {deltaPositive && "+"}
                {formatCurrency(delta.dollar)} ({formatPercent(delta.pct, { signed: true })})
              </span>
              <span className="text-xs text-app-muted">today</span>
            </div>
          ) : (
            <p className="text-sm text-app-dim mt-2">No prior data</p>
          )}
        </div>

        {/* Sparkline */}
        {sparkData.length > 1 && (
          <div
            style={{ width: 100, height: 48 }}
            role="img"
            aria-label="60-day net worth sparkline"
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
    </div>
  );
}
