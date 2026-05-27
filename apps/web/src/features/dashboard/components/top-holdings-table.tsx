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
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
        <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
          Top Holdings
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No holdings yet.</p>
      </div>
    );
  }

  const totalFloat = totalNetWorth.toFloat();

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
        Top Holdings
      </p>

      {/* Single grid so header and rows share columns and stay aligned. */}
      <div className="grid grid-cols-[minmax(4ch,1fr)_auto_auto] gap-x-4">
        <span className="text-xs text-neutral-400 dark:text-neutral-600 font-medium pb-2">
          Ticker
        </span>
        <span className="text-xs text-neutral-400 dark:text-neutral-600 font-medium text-right pb-2">
          Value
        </span>
        <span className="text-xs text-neutral-400 dark:text-neutral-600 font-medium text-right pb-2">
          Alloc
        </span>

        {sorted.map((h) => {
          const allocShare = totalNetWorth.isZero() ? 0 : h.marketValue.toFloat() / totalFloat;
          return (
            <div key={`${h.key}-row`} className="contents">
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50 truncate py-2 border-t border-neutral-100 dark:border-neutral-800">
                {h.ticker}
              </span>
              <span className="text-right text-sm tabular-nums text-neutral-700 dark:text-neutral-300 py-2 border-t border-neutral-100 dark:border-neutral-800">
                {formatCurrency(h.marketValue)}
              </span>
              <span className="text-right text-sm tabular-nums text-neutral-500 dark:text-neutral-400 py-2 border-t border-neutral-100 dark:border-neutral-800">
                {formatPercent(allocShare)}
              </span>
            </div>
          );
        })}
      </div>

      <Link
        href="/app/holdings"
        className="flex items-center justify-end mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none rounded"
        aria-label="View all holdings"
      >
        <span className="text-sm text-gold-600 dark:text-gold-400 font-medium mr-1">
          View all holdings
        </span>
        <ArrowRight size={14} className="text-gold-600 dark:text-gold-400" />
      </Link>
    </div>
  );
}
