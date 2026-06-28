"use client";

import type { Decimal, NetWorthBreakdown } from "@privance/core";
import { formatCurrencyWhole, formatPercent } from "@/lib/format";

type SplitTileProps = {
  label: string;
  value: string;
  valueColor?: string;
  subline: string;
  sublineColor?: string;
};

function SplitTile({
  label,
  value,
  valueColor = "",
  subline,
  sublineColor = "text-dim",
}: SplitTileProps) {
  return (
    <div className="glass rounded-[10px] px-5 py-5 max-[480px]:px-4 max-[480px]:py-4">
      <p className="font-mono text-xs tracking-label uppercase text-faint">{label}</p>
      <p className={`vfig font-serif text-3xl mt-2 max-[480px]:text-2xl ${valueColor}`}>{value}</p>
      <p className={`vfig font-mono text-xs mt-1 max-[480px]:text-xs ${sublineColor}`}>{subline}</p>
    </div>
  );
}

type SplitsRowProps = {
  breakdown: NetWorthBreakdown;
  delta: { dollar: Decimal; pct: number } | null;
  portfolioGain: { gainCents: Decimal; gainPct: number };
};

export function SplitsRow({ breakdown, delta, portfolioGain }: SplitsRowProps) {
  const liabCount = breakdown.byAccount.filter((a) => a.kind === "liability").length;
  const assetCount = breakdown.byAccount.filter((a) => a.kind !== "liability").length;

  const gainPositive = !portfolioGain.gainCents.isNegative() && !portfolioGain.gainCents.isZero();
  const gainNegative = portfolioGain.gainCents.isNegative();

  const deltaPositive = delta !== null && !delta.dollar.isNegative() && !delta.dollar.isZero();
  const deltaNegative = delta?.dollar.isNegative();

  return (
    <div className="grid grid-cols-4 gap-4 max-[880px]:grid-cols-2">
      <SplitTile
        label="Assets"
        value={formatCurrencyWhole(breakdown.totalAssets)}
        subline={`across ${assetCount} account${assetCount !== 1 ? "s" : ""}`}
      />
      <SplitTile
        label="Liabilities"
        value={
          breakdown.totalLiabilities.isZero()
            ? "$0"
            : `-${formatCurrencyWhole(breakdown.totalLiabilities)}`
        }
        subline={`${liabCount} loan${liabCount !== 1 ? "s" : ""}`}
      />
      <SplitTile
        label="Unrealized"
        value={`${gainPositive ? "+" : ""}${formatCurrencyWhole(portfolioGain.gainCents)}`}
        valueColor={gainPositive ? "text-up" : gainNegative ? "text-down" : ""}
        subline={`${formatPercent(portfolioGain.gainPct, { signed: true })} on cost`}
        sublineColor={gainPositive ? "text-up" : gainNegative ? "text-down" : "text-dim"}
      />
      <SplitTile
        label="Today"
        value={
          delta === null ? "-" : `${deltaPositive ? "+" : ""}${formatCurrencyWhole(delta.dollar)}`
        }
        valueColor={deltaPositive ? "text-up" : deltaNegative ? "text-down" : ""}
        subline={delta === null ? "no price data" : formatPercent(delta.pct, { signed: true })}
        sublineColor={deltaPositive ? "text-up" : deltaNegative ? "text-down" : "text-dim"}
      />
    </div>
  );
}
