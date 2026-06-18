"use client";

import type { Decimal, Holding, HoldingId, HoldingValuation } from "@privance/core";
import Link from "next/link";
import { humanizeCryptoId } from "@/features/holdings";
import type { LocalHolding } from "@/features/holdings/types";
import type { SymbolProfileEntry } from "@/lib/api/symbol-profiles";
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
  /** Full holding records for name lookup and detail sheet. */
  holdings: Holding[];
  /** Server-resolved instrument profiles by ticker; supplies display names. */
  profilesByTicker?: ReadonlyMap<string, SymbolProfileEntry>;
  /** Called when a row is clicked; receives the first LocalHolding for that aggregated key. */
  onRowClick: (holding: LocalHolding) => void;
};

const MAX_ROWS = 10;

type AggregatedRow = {
  key: string;
  /** Primary holdingId, the first holdingId seen when building this aggregate. */
  primaryHoldingId: HoldingId;
  ticker: string;
  name: string | undefined;
  marketValue: Decimal;
  /** Sum of per-holding day change across all rows sharing the ticker. Null when none reported. */
  dayChange: Decimal | null;
};

function aggregateByTicker(
  byHolding: readonly HoldingValuation[],
  tickerById: ReadonlyMap<HoldingId, string>,
  groupKeyById: ReadonlyMap<HoldingId, string>,
  dayChangeByHoldingId: ReadonlyMap<HoldingId, Decimal>,
  holdingNameById: ReadonlyMap<HoldingId, string | undefined>,
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
        ...existing,
        marketValue: existing.marketValue.add(h.marketValue),
        dayChange: combinedDay,
      });
    } else {
      merged.set(key, {
        key,
        primaryHoldingId: h.holdingId,
        ticker: displayTicker,
        name: holdingNameById.get(h.holdingId),
        marketValue: h.marketValue,
        dayChange: rowDay,
      });
    }
  }
  return [...merged.values()];
}

function toLocalHolding(h: Holding): LocalHolding {
  return {
    id: h.id,
    accountId: h.payload.accountId,
    groupId: h.payload.groupId,
    ticker: h.payload.ticker,
    assetType: h.payload.assetType,
    proxyTicker: h.payload.proxyTicker,
    sharesMajor: h.payload.sharesMajor,
    sharesScale: h.payload.sharesScale,
    costBasisCents: h.payload.costBasisCents,
    scaleFactor: h.payload.scaleFactor,
    proxyAnchoredAt: h.payload.proxyAnchoredAt,
    name: h.payload.name,
    updatedAt: 0,
  };
}

export function TopHoldingsTable({
  byHolding,
  tickerById,
  groupKeyById,
  totalInvestments,
  dayChangeByHoldingId,
  holdings,
  profilesByTicker,
  onRowClick,
}: TopHoldingsTableProps) {
  const holdingById = new Map<HoldingId, Holding>(holdings.map((h) => [h.id, h]));
  const holdingNameById = new Map<HoldingId, string | undefined>(
    holdings.map((h) => {
      // Match the aggregation key: proxied holdings take the proxy's name.
      const priceTicker = h.payload.proxyTicker ?? h.payload.ticker;
      const fallback =
        h.payload.assetType === "crypto" ? humanizeCryptoId(h.payload.ticker) : undefined;
      return [h.id, profilesByTicker?.get(priceTicker)?.displayName ?? h.payload.name ?? fallback];
    }),
  );

  const sorted = aggregateByTicker(
    byHolding,
    tickerById,
    groupKeyById,
    dayChangeByHoldingId,
    holdingNameById,
  )
    .sort((a, b) => b.marketValue.cmp(a.marketValue))
    .slice(0, MAX_ROWS);

  if (sorted.length === 0) {
    return (
      <div className="bg-panel border border-line rounded-[10px] p-6 h-full">
        <h3 className="font-serif text-[20px] font-normal tracking-[-0.005em] mb-4">
          Top holdings
        </h3>
        <p className="text-sm text-dim">No holdings yet.</p>
      </div>
    );
  }

  const totalFloat = totalInvestments.toFloat();

  return (
    <div className="bg-panel border border-line rounded-[10px] p-6 h-full">
      <div className="flex items-baseline justify-between mb-4 gap-2.5">
        <h3 className="font-serif text-[20px] font-normal tracking-[-0.005em]">Top holdings</h3>
        <Link
          href="/app/holdings"
          className="font-mono text-[10px] tracking-[.14em] uppercase text-faint hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded"
          aria-label="View all holdings"
        >
          All {byHolding.length} &rarr;
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table aria-label="Top holdings" className="w-full">
          <thead>
            <tr>
              <th
                scope="col"
                className="font-mono text-[9.5px] tracking-[.16em] uppercase text-faint font-normal text-left pb-3"
              >
                Holding
              </th>
              <th
                scope="col"
                className="font-mono text-[9.5px] tracking-[.16em] uppercase text-faint font-normal text-right pb-3"
              >
                Day
              </th>
              <th
                scope="col"
                className="hidden md:table-cell font-mono text-[9.5px] tracking-[.16em] uppercase text-faint font-normal text-right pb-3"
              >
                Weight
              </th>
              <th
                scope="col"
                className="font-mono text-[9.5px] tracking-[.16em] uppercase text-faint font-normal text-right pb-3"
              >
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => {
              const allocShare = totalInvestments.isZero()
                ? 0
                : h.marketValue.toFloat() / totalFloat;
              const weightPct = allocShare * 100;

              // Day % vs prior: change / (marketValue - change). Guard against zero/negative prior.
              const prior = h.dayChange !== null ? h.marketValue.sub(h.dayChange) : null;
              const priorAboveTol =
                prior !== null &&
                !prior.isNegative() &&
                prior.toMinorUnits() * 10000n > h.marketValue.toMinorUnits();
              const dayPct =
                h.dayChange !== null && prior !== null && priorAboveTol
                  ? h.dayChange.toFloat() / prior.toFloat()
                  : null;
              const dayPositive =
                h.dayChange !== null && !h.dayChange.isNegative() && !h.dayChange.isZero();
              const dayZero = h.dayChange === null || h.dayChange.isZero();
              const dayColor =
                h.dayChange === null
                  ? "text-dim"
                  : dayZero
                    ? "text-dim"
                    : dayPositive
                      ? "text-up"
                      : "text-down";

              const primaryHolding = holdingById.get(h.primaryHoldingId);
              const handleClick = primaryHolding
                ? () => onRowClick(toLocalHolding(primaryHolding))
                : undefined;

              return (
                <tr
                  key={h.key}
                  onClick={handleClick}
                  onKeyDown={
                    handleClick
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleClick();
                          }
                        }
                      : undefined
                  }
                  tabIndex={handleClick ? 0 : undefined}
                  aria-label={handleClick ? `${h.ticker}, open holding details` : undefined}
                  className={
                    handleClick
                      ? "cursor-pointer hover:bg-[rgba(235,235,230,0.015)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                      : undefined
                  }
                >
                  {/* Holding: ticker (mono, cream) + name (dim, smaller) */}
                  <td className="border-t border-line-soft py-[13px] tabular-nums text-left">
                    <p className="font-mono text-[12.5px] tracking-[.04em] text-cream truncate">
                      {h.ticker}
                    </p>
                    {h.name !== undefined && (
                      <p className="hidden md:block text-[12px] text-dim mt-0.5 truncate">
                        {h.name}
                      </p>
                    )}
                  </td>

                  <td
                    className={`border-t border-line-soft py-[13px] tabular-nums text-right font-mono text-[12.5px] ${dayColor}`}
                  >
                    {h.dayChange === null || dayPct === null
                      ? "-"
                      : formatPercent(dayPct, { signed: true })}
                  </td>

                  <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right">
                    <span className="inline-flex items-center gap-2.5 justify-end">
                      <span
                        className="w-[74px] h-1 rounded-[2px] bg-[rgba(235,235,230,0.08)] overflow-hidden"
                        aria-hidden="true"
                      >
                        <i
                          className="block h-full bg-accent rounded-[2px]"
                          style={{ width: `${Math.min(100, weightPct).toFixed(1)}%` }}
                        />
                      </span>
                      <span className="font-mono text-[11.5px] text-dim w-11 text-right">
                        {formatPercent(allocShare)}
                      </span>
                    </span>
                  </td>

                  <td className="border-t border-line-soft py-[13px] tabular-nums text-right font-mono text-[13px] text-cream">
                    <span className="vfig">{formatCurrency(h.marketValue)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
