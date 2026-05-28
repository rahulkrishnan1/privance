"use client";

import type { Decimal, HoldingId, HoldingValuation } from "@privance/core";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { formatCurrency, formatPercent } from "@/lib/format";

type TopHoldingsTableProps = {
  byHolding: readonly HoldingValuation[];
  tickerById: ReadonlyMap<HoldingId, string>;
  /** Composite key (ticker + proxyTicker) so holdings sharing a display ticker
   *  but priced via different proxies don't collapse into one row. */
  groupKeyById: ReadonlyMap<HoldingId, string>;
  /** Sum of all holding market values; used as the alloc denominator. */
  totalInvestments: Decimal;
  /** Per-holding day change in cents; absent when prior price isn't available. */
  dayChangeByHoldingId: ReadonlyMap<HoldingId, Decimal>;
};

const MAX_ROWS = 10;

type AggregatedRow = {
  key: string;
  ticker: string;
  marketValue: Decimal;
  /** Sum of per-holding day change across all rows sharing the ticker. Null when none reported. */
  dayChange: Decimal | null;
};

function aggregateByTicker(
  byHolding: readonly HoldingValuation[],
  tickerById: ReadonlyMap<HoldingId, string>,
  groupKeyById: ReadonlyMap<HoldingId, string>,
  dayChangeByHoldingId: ReadonlyMap<HoldingId, Decimal>,
): AggregatedRow[] {
  const merged = new Map<string, AggregatedRow>();
  for (const h of byHolding) {
    if (h.marketValue.isNegative()) continue;
    const ticker = tickerById.get(h.holdingId);
    const key = groupKeyById.get(h.holdingId) ?? `__id:${h.holdingId}`;
    const displayTicker = ticker ?? h.holdingId.slice(0, 8);
    const rowDay = dayChangeByHoldingId.get(h.holdingId) ?? null;

    const existing = merged.get(key);
    if (existing) {
      const combinedDay =
        existing.dayChange === null
          ? rowDay
          : rowDay === null
            ? existing.dayChange
            : existing.dayChange.add(rowDay);
      merged.set(key, {
        key,
        ticker: displayTicker,
        marketValue: existing.marketValue.add(h.marketValue),
        dayChange: combinedDay,
      });
    } else {
      merged.set(key, {
        key,
        ticker: displayTicker,
        marketValue: h.marketValue,
        dayChange: rowDay,
      });
    }
  }
  return [...merged.values()];
}

export function TopHoldingsTable({
  byHolding,
  tickerById,
  groupKeyById,
  totalInvestments,
  dayChangeByHoldingId,
}: TopHoldingsTableProps) {
  const sorted = aggregateByTicker(byHolding, tickerById, groupKeyById, dayChangeByHoldingId)
    .sort((a, b) => b.marketValue.cmp(a.marketValue))
    .slice(0, MAX_ROWS);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-app-line bg-app-panel p-4">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim mb-4">
          Top holdings
        </p>
        <p className="text-sm text-app-muted">No holdings yet.</p>
      </div>
    );
  }

  const totalFloat = totalInvestments.toFloat();
  // px-2 mobile / px-3 desktop matches the spacing on the full Holdings table.
  const cellPadding = "px-2 sm:px-3";
  const headerClass = `font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim pb-2 font-normal ${cellPadding}`;
  const numericCellClass = `text-right font-mono text-[12px] sm:text-[14px] tabular-nums py-2 border-t border-app-line-soft ${cellPadding}`;

  return (
    <div className="rounded-xl border border-app-line bg-app-panel p-4">
      <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim mb-4">
        Top holdings
      </p>

      {/* table-auto sizes each column to its widest cell + padding, which is
          the standard for data tables: predictable spacing between content,
          no fixed widths that crush long currency values. Ticker hugs left,
          numeric cells push to the right and align to each other. */}
      <table aria-label="Top holdings" className="w-full">
        <thead>
          <tr>
            <th scope="col" className={`${headerClass} text-left`}>
              Ticker
            </th>
            <th scope="col" className={`${headerClass} text-right`}>
              Day
            </th>
            <th scope="col" className={`${headerClass} text-right`}>
              Value
            </th>
            <th scope="col" className={`${headerClass} text-right`}>
              Alloc
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => {
            const allocShare = totalInvestments.isZero() ? 0 : h.marketValue.toFloat() / totalFloat;
            // % vs prior value: change / (marketValue − change). Guard against
            // zero or negative prior so we never render NaN/Infinity or a
            // sign-flipped %; both are reachable after aggregation if a
            // collapsed-to-zero underlying joins a still-positive one.
            const prior = h.dayChange !== null ? h.marketValue.sub(h.dayChange) : null;
            const dayPct =
              h.dayChange !== null && prior !== null && !prior.isZero() && !prior.isNegative()
                ? h.dayChange.toFloat() / prior.toFloat()
                : null;
            const dayPositive =
              h.dayChange !== null && !h.dayChange.isNegative() && !h.dayChange.isZero();
            const dayZero = h.dayChange === null || h.dayChange.isZero();
            const dayColor =
              h.dayChange === null
                ? "text-app-dim"
                : dayZero
                  ? "text-app-muted"
                  : dayPositive
                    ? "text-app-green"
                    : "text-app-red";
            return (
              <tr key={h.key}>
                <td
                  className={`text-[13px] sm:text-sm font-medium text-app-text truncate py-2 border-t border-app-line-soft ${cellPadding}`}
                >
                  {h.ticker}
                </td>
                <td className={`${numericCellClass} ${dayColor}`}>
                  {h.dayChange === null || dayPct === null
                    ? "—"
                    : formatPercent(dayPct, { signed: true })}
                </td>
                <td className={`${numericCellClass} text-app-text`}>
                  {formatCurrency(h.marketValue)}
                </td>
                <td className={`${numericCellClass} text-app-muted`}>
                  {formatPercent(allocShare)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Link
        href="/app/holdings"
        className="flex items-center justify-end mt-3 pt-3 border-t border-app-line-soft hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] rounded"
        aria-label="View all holdings"
      >
        <span className="text-sm text-gold-accent font-medium mr-1">View all holdings</span>
        <ArrowRight size={14} className="text-gold-accent" />
      </Link>
    </div>
  );
}
