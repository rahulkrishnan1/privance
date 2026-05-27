"use client";

import type { Decimal, HoldingValuation } from "@privance/core";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatCurrency, formatPercent } from "@/lib/format";

type TopHoldingsTableProps = {
  byHolding: readonly HoldingValuation[];
  tickerById: ReadonlyMap<string, string>;
  totalNetWorth: Decimal;
};

const MAX_ROWS = 10;

// Same ticker held across multiple accounts collapses into one row. Unknown
// tickers (no entry in tickerById) keep their holdingId so unrelated rows
// don't merge.
function aggregateByTicker(
  byHolding: readonly HoldingValuation[],
  tickerById: ReadonlyMap<string, string>,
): { key: string; ticker: string; marketValue: Decimal }[] {
  const merged = new Map<string, { ticker: string; marketValue: Decimal }>();
  for (const h of byHolding) {
    if (h.marketValue.isNegative()) continue;
    const ticker = tickerById.get(h.holdingId);
    const key = ticker ?? `__id:${h.holdingId}`;
    const displayTicker = ticker ?? h.holdingId.slice(0, 8);
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, {
        ticker: displayTicker,
        marketValue: existing.marketValue.add(h.marketValue),
      });
    } else {
      merged.set(key, { ticker: displayTicker, marketValue: h.marketValue });
    }
  }
  return [...merged.entries()].map(([key, v]) => ({ key, ...v }));
}

export function TopHoldingsTable({ byHolding, tickerById, totalNetWorth }: TopHoldingsTableProps) {
  const sorted = aggregateByTicker(byHolding, tickerById)
    .sort((a, b) => b.marketValue.cmp(a.marketValue))
    .slice(0, MAX_ROWS);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-app-line bg-app-panel p-4">
        <p className="text-sm font-semibold text-app-text mb-3">Top Holdings</p>
        <p className="text-sm text-app-muted">No holdings yet.</p>
      </div>
    );
  }

  const totalFloat = totalNetWorth.toFloat();

  return (
    <div className="rounded-xl border border-app-line bg-app-panel p-4">
      <p className="text-sm font-semibold text-app-text mb-3">Top Holdings</p>

      {/* Single grid so header and rows share columns and stay aligned. */}
      <div className="grid grid-cols-[minmax(4ch,1fr)_auto_auto] gap-x-4">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim pb-2">
          Ticker
        </span>
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim text-right pb-2">
          Value
        </span>
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim text-right pb-2">
          Alloc
        </span>

        {sorted.map((h) => {
          const allocShare = totalNetWorth.isZero() ? 0 : h.marketValue.toFloat() / totalFloat;
          return (
            <div key={`${h.key}-row`} className="contents">
              <span className="text-sm font-medium text-app-text truncate py-2 border-t border-app-line-soft">
                {h.ticker}
              </span>
              <span className="text-right font-mono text-[14px] tabular-nums text-app-text py-2 border-t border-app-line-soft">
                {formatCurrency(h.marketValue)}
              </span>
              <span className="text-right font-mono text-[14px] tabular-nums text-app-muted py-2 border-t border-app-line-soft">
                {formatPercent(allocShare)}
              </span>
            </div>
          );
        })}
      </div>

      <Link
        href="/app/holdings"
        className="flex items-center justify-end mt-3 pt-3 border-t border-app-line-soft hover:opacity-80 focus-visible:ring-2 focus-visible:ring-gold-accent/40 focus-visible:outline-none rounded"
        aria-label="View all holdings"
      >
        <span className="text-sm text-gold-accent font-medium mr-1">View all holdings</span>
        <ArrowRight size={14} className="text-gold-accent" />
      </Link>
    </div>
  );
}
