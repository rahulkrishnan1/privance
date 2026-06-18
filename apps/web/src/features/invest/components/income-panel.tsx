"use client";

import { useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { EstimatedIncomeResult } from "../_invest-math";

type IncomePanelProps = {
  result: EstimatedIncomeResult;
};

const TOP_PAYERS = 3;

export function IncomePanel({ result }: IncomePanelProps) {
  const { annualCents, portfolioYield, monthlyCents, payers } = result;
  const [expanded, setExpanded] = useState(false);

  if (payers.length === 0) {
    return null;
  }

  const hasMore = payers.length > TOP_PAYERS;
  const visiblePayers = expanded ? payers : payers.slice(0, TOP_PAYERS);

  return (
    <div className="bg-panel border border-line rounded-[10px] p-6 h-full">
      <div className="flex justify-between items-baseline mb-4 gap-2.5 flex-wrap">
        <h3 className="font-serif text-[20px] font-normal tracking-[-0.005em]">Income</h3>
        <span className="font-mono text-[10px] tracking-[.14em] uppercase text-faint">
          {payers.length} {payers.length === 1 ? "payer" : "payers"}
        </span>
      </div>

      <p className="vfig font-serif text-[27px] leading-none">
        {formatCurrency(annualCents)}{" "}
        <span className="font-mono text-[11px] text-faint">/ yr forward</span>
      </p>
      <p className="font-mono text-[10.5px] text-dim mt-1">
        {formatPercent(portfolioYield)} portfolio yield &middot;{" "}
        <span className="vfig">&#8776;{formatCurrency(monthlyCents)}/mo</span>
      </p>

      <div className="mt-4">
        {visiblePayers.map((payer) => (
          <div
            key={payer.id}
            className="flex items-center gap-3 py-[11px] border-b border-line-soft last:border-b-0"
          >
            <span className="font-mono text-[11px] tracking-[.06em] text-accent bg-panel-2 border border-line rounded-[5px] px-[9px] py-[5px] flex-none">
              {payer.ticker}
            </span>
            <span className="flex-1 text-[14px] text-cream truncate max-[400px]:hidden">
              {payer.name}
            </span>
            <span className="vfig font-mono text-[12.5px] text-cream-soft tabular-nums whitespace-nowrap max-[400px]:ml-auto">
              {formatCurrency(payer.annualCents)}/yr
            </span>
            <span className="font-mono text-[12.5px] text-dim tabular-nums">
              {(payer.yield * 100).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-3 font-mono text-[10px] tracking-[.14em] uppercase text-faint hover:text-accent transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded"
        >
          {expanded ? "Show less" : `Show all ${payers.length}`}
        </button>
      )}

      <p className="font-mono text-[9.5px] tracking-[.06em] text-faint mt-3.5 leading-[1.7]">
        forward estimate from dividend yields and cash APY
      </p>
    </div>
  );
}
