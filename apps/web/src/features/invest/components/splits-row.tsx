"use client";

import type { Decimal, NetWorthBreakdown } from "@privance/core";
import type { ReactNode } from "react";
import { formatCurrencyWhole, formatPercentMagnitude, trendTriangle } from "@/lib/format";

type SplitTileProps = {
  label: string;
  value: ReactNode;
  valueColor?: string;
  subline: string;
  sublineColor?: string;
};

/**
 * Whole-dollar value with a leading trend triangle sized down to a marker so it
 * doesn't swallow the large serif number. Direction comes from the value's sign.
 */
function trendAmount(value: Decimal): ReactNode {
  const glyph = trendTriangle(value.isNegative(), value.isZero());
  const amount = formatCurrencyWhole(value.abs());
  if (glyph === "") return amount;
  return (
    <>
      <span className="text-[0.5em] align-middle mr-1.5">{glyph}</span>
      {amount}
    </>
  );
}

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
        value={trendAmount(portfolioGain.gainCents)}
        valueColor={gainPositive ? "text-up" : gainNegative ? "text-down" : ""}
        subline={`${formatPercentMagnitude(portfolioGain.gainPct)} on cost`}
        sublineColor={gainPositive ? "text-up" : gainNegative ? "text-down" : "text-dim"}
      />
      <SplitTile
        label="Today"
        value={delta === null ? "-" : trendAmount(delta.dollar)}
        valueColor={deltaPositive ? "text-up" : deltaNegative ? "text-down" : ""}
        subline={delta === null ? "no price data" : `${formatPercentMagnitude(delta.pct)} today`}
        sublineColor={deltaPositive ? "text-up" : deltaNegative ? "text-down" : "text-dim"}
      />
    </div>
  );
}
