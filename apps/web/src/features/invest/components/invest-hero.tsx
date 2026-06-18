"use client";

import type { Decimal, NetWorthBreakdown } from "@privance/core";
import dynamic from "next/dynamic";
import { HistoryChartSkeleton } from "@/features/dashboard/components/skeletons";
import { formatCurrencyWhole, formatPercent } from "@/lib/format";
import type { HistoryPoint } from "../../dashboard/types";

const HistoryChart = dynamic(
  () =>
    import("@/features/dashboard/components/history-chart").then((m) => ({
      default: m.HistoryChart,
    })),
  { ssr: false, loading: () => <HistoryChartSkeleton /> },
);

type InvestHeroProps = {
  breakdown: NetWorthBreakdown;
  delta: { dollar: Decimal; pct: number } | null;
  historyPoints: HistoryPoint[];
};

export function InvestHero({ breakdown, delta, historyPoints }: InvestHeroProps) {
  const nw = breakdown.netWorth;
  const nwDisplay = formatCurrencyWhole(nw);

  const isPositive = delta !== null && !delta.dollar.isNegative() && !delta.dollar.isZero();
  const isNegative = delta?.dollar.isNegative();

  const deltaColor = isPositive ? "text-up" : isNegative ? "text-down" : "text-dim";
  const deltaBorder = isPositive
    ? "border-up/25 bg-up/7"
    : isNegative
      ? "border-down/25 bg-down/7"
      : "border-line bg-panel-2";

  return (
    <section className="pt-11 pb-0 relative">
      <p className="font-mono text-[10px] tracking-[.26em] uppercase text-faint">Net worth</p>

      <div className="flex items-end gap-5 flex-wrap mt-3">
        <span
          data-testid="invest-net-worth"
          className="vfig font-serif text-[clamp(52px,7.5vw,84px)] leading-[.95] tracking-[-0.015em]"
        >
          {nwDisplay}
        </span>

        {delta !== null && (
          <span
            className={[
              "vfig flex items-center gap-2 font-mono text-[12.5px] border rounded-full px-3.5 py-1.5 mb-2.5",
              deltaColor,
              deltaBorder,
            ].join(" ")}
          >
            {isPositive ? "+" : ""}
            {formatCurrencyWhole(delta.dollar)}
            <span className="text-dim"> &middot; {formatPercent(delta.pct, { signed: true })}</span>
          </span>
        )}
      </div>

      <HistoryChart points={historyPoints} className="mt-[26px]" />
    </section>
  );
}
