"use client";

import { useState } from "react";
import { CadenceSuffix } from "@/components";
import { formatCurrency, formatPercent } from "@/lib/format";
import { useFillCount } from "@/lib/use-fill-count";
import { useMediaQuery } from "@/lib/use-media-query";
import type { EstimatedIncomeResult } from "../_invest-math";

type IncomePanelProps = {
  result: EstimatedIncomeResult;
};

const TOP_PAYERS = 3;

export function IncomePanel({ result }: IncomePanelProps) {
  const { annualCents, portfolioYield, payers } = result;
  const [expanded, setExpanded] = useState(false);

  // Desktop fills the "Where it lives"-driven height; mobile shows a fixed preview.
  const isWide = useMediaQuery("(min-width: 881px)");
  const { areaRef, rowRef, count, minHeight } = useFillCount<HTMLDivElement, HTMLDivElement>({
    active: isWide && !expanded,
    total: payers.length,
    collapsed: TOP_PAYERS,
  });

  if (payers.length === 0) {
    return null;
  }

  const hasMore = payers.length > count;
  const visiblePayers = expanded ? payers : payers.slice(0, count);

  return (
    <div className="glass rounded-[10px] p-6 h-full flex flex-col">
      <div className="flex justify-between items-baseline mb-4 gap-2.5 flex-wrap">
        <h3 className="font-serif text-2xl font-normal tracking-[-0.005em]">Income</h3>
        <span className="font-mono text-xs tracking-label uppercase text-faint">
          {payers.length} {payers.length === 1 ? "payer" : "payers"}
        </span>
      </div>

      <p className="font-serif text-3xl leading-none">
        <span className="vfig">{formatCurrency(annualCents)}</span>
        <CadenceSuffix unit="year forward" className="font-mono text-sm text-faint" />
      </p>
      <p className="font-mono text-xs text-dim mt-1">
        {formatPercent(portfolioYield)} portfolio yield
      </p>

      <div
        ref={areaRef}
        // Desktop scrolls sideways rather than clip a wide value in a narrow card.
        className={`mt-4${isWide && !expanded ? " flex-1 overflow-x-auto overflow-y-hidden" : ""}`}
        style={isWide && !expanded ? { minHeight } : undefined}
      >
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-8">
          {visiblePayers.map((payer, idx) => (
            <div
              key={payer.id}
              ref={idx === 0 ? rowRef : undefined}
              className="col-span-3 grid grid-cols-subgrid items-center py-[11px] border-b border-line-soft last:border-b-0"
            >
              <span className="justify-self-start font-mono text-xs tracking-[.06em] text-accent bg-panel-2 border border-line rounded-[5px] px-[9px] py-[5px]">
                {payer.ticker}
              </span>
              <span className="font-mono text-sm text-cream tabular-nums text-right">
                <span className="vfig">{formatCurrency(payer.annualCents)}</span>
                <CadenceSuffix unit="yr" className="text-faint" />
              </span>
              <span className="font-mono text-sm text-dim tabular-nums text-right">
                {(payer.yield * 100).toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-3 font-mono text-xs tracking-button uppercase text-faint hover:text-accent transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded"
        >
          {expanded ? "Show less" : `Show all ${payers.length}`}
        </button>
      )}

      <p className="font-mono text-xs tracking-[.06em] text-faint mt-3.5 leading-[1.7]">
        forward estimate from dividend yields and cash APY
      </p>
    </div>
  );
}
