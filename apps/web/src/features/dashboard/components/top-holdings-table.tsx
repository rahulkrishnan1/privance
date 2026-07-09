"use client";

import { Decimal, type Holding, type HoldingId, type HoldingValuation } from "@privance/core";
import Link from "next/link";
import { ChangePill } from "@/components/ui/change-pill";
import type { LocalHolding } from "@/features/holdings/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { useFillCount } from "@/lib/use-fill-count";
import { useMediaQuery } from "@/lib/use-media-query";

type TopHoldingsTableProps = {
  byHolding: readonly HoldingValuation[];
  tickerById: ReadonlyMap<HoldingId, string>;
  /** Composite key (ticker + proxyTicker) so holdings sharing a display ticker
   *  but priced via different proxies don't collapse into one row. */
  groupKeyById: ReadonlyMap<HoldingId, string>;
  /** Per-holding day change in cents; absent when prior price isn't available. */
  dayChangeByHoldingId: ReadonlyMap<HoldingId, Decimal>;
  /** Full holding records for the detail sheet. */
  holdings: Holding[];
  /** Called when a row is clicked; receives the first LocalHolding for that aggregated key. */
  onRowClick: (holding: LocalHolding) => void;
};

const MAX_ROWS = 5;

type AggregatedRow = {
  key: string;
  /** Primary holdingId, the first holdingId seen when building this aggregate. */
  primaryHoldingId: HoldingId;
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
        ...existing,
        marketValue: existing.marketValue.add(h.marketValue),
        dayChange: combinedDay,
      });
    } else {
      merged.set(key, {
        key,
        primaryHoldingId: h.holdingId,
        ticker: displayTicker,
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
  dayChangeByHoldingId,
  holdings,
  onRowClick,
}: TopHoldingsTableProps) {
  const holdingById = new Map<HoldingId, Holding>(holdings.map((h) => [h.id, h]));
  const marketValueByHolding = new Map<HoldingId, Decimal>(
    byHolding.map((h) => [h.holdingId, h.marketValue]),
  );

  const aggregated = aggregateByTicker(
    byHolding,
    tickerById,
    groupKeyById,
    dayChangeByHoldingId,
  ).sort((a, b) => b.marketValue.cmp(a.marketValue));

  const isWide = useMediaQuery("(min-width: 881px)");
  const { areaRef, rowRef, count, minHeight } = useFillCount<HTMLDivElement, HTMLTableRowElement>({
    active: isWide,
    total: aggregated.length,
    collapsed: MAX_ROWS,
  });
  const sorted = aggregated.slice(0, count);

  if (aggregated.length === 0) {
    return (
      <div className="glass rounded-[10px] p-6 h-full">
        <h3 className="font-serif text-2xl font-normal tracking-[-0.005em] mb-4">Top holdings</h3>
        <p className="text-sm text-dim">No holdings yet.</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-[10px] p-6 h-full flex flex-col">
      <div className="flex items-baseline justify-between mb-4 gap-2.5">
        <h3 className="font-serif text-2xl font-normal tracking-[-0.005em]">Top holdings</h3>
        <Link
          href="/app/holdings"
          className="font-mono text-xs tracking-button uppercase text-faint hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded"
          aria-label="View all holdings"
        >
          All {byHolding.length} &rarr;
        </Link>
      </div>

      {/* Desktop fills the Allocation-driven height with the rows that fit (never
          fewer than the preview); mobile keeps the original in-flow scroll area. */}
      <div
        ref={areaRef}
        className={isWide ? "flex-1 overflow-x-auto overflow-y-hidden" : "overflow-x-auto"}
        style={isWide ? { minHeight } : undefined}
      >
        {/* Holding column (w-full) absorbs the slack and truncates; numeric
            columns hug their content (whitespace-nowrap) so they sit adjacent. */}
        <table aria-label="Top holdings" className="w-full">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-full font-mono text-xs tracking-label uppercase text-faint font-normal text-left pb-3"
              >
                Holding
              </th>
              <th
                scope="col"
                className="font-mono text-xs tracking-label uppercase text-faint font-normal text-right pb-3 pl-8 whitespace-nowrap"
              >
                Day
              </th>
              <th
                scope="col"
                className="font-mono text-xs tracking-label uppercase text-faint font-normal text-right pb-3 pl-8 whitespace-nowrap"
              >
                Price
              </th>
              <th
                scope="col"
                className="hidden md:table-cell font-mono text-xs tracking-label uppercase text-faint font-normal text-right pb-3 pl-8 whitespace-nowrap"
              >
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h, idx) => {
              // Per-share price = primary holding's market value / its shares (all
              // holdings sharing a ticker price identically, so the primary stands in).
              const price = (() => {
                const primary = holdingById.get(h.primaryHoldingId);
                const primaryValue = marketValueByHolding.get(h.primaryHoldingId);
                if (primary === undefined || primaryValue === undefined) return null;
                try {
                  const shares = Decimal.fromString(
                    primary.payload.sharesMajor,
                    primary.payload.sharesScale,
                  );
                  return shares.isZero() ? null : primaryValue.div(shares);
                } catch {
                  return null;
                }
              })();

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

              const primaryHolding = holdingById.get(h.primaryHoldingId);
              const handleClick = primaryHolding
                ? () => onRowClick(toLocalHolding(primaryHolding))
                : undefined;

              return (
                <tr
                  key={h.key}
                  ref={idx === 0 ? rowRef : undefined}
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
                  role={handleClick ? "button" : undefined}
                  tabIndex={handleClick ? 0 : undefined}
                  aria-label={handleClick ? `${h.ticker}, open holding details` : undefined}
                  className={
                    handleClick
                      ? "cursor-pointer hover:bg-cream/2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                      : undefined
                  }
                >
                  <td className="border-t border-line-soft py-[13px] tabular-nums text-left max-w-0">
                    <p className="font-mono text-sm tracking-[.04em] text-cream truncate">
                      {h.ticker}
                    </p>
                  </td>

                  <td className="border-t border-line-soft py-[13px] tabular-nums text-right whitespace-nowrap pl-8">
                    {h.dayChange === null || dayPct === null ? (
                      <span className="font-mono text-sm text-dim">-</span>
                    ) : (
                      <ChangePill tone={dayZero ? "flat" : dayPositive ? "up" : "down"} pad="roomy">
                        {formatPercent(dayPct, { signed: true })}
                      </ChangePill>
                    )}
                  </td>

                  <td className="border-t border-line-soft py-[13px] tabular-nums text-right font-mono text-sm text-cream whitespace-nowrap pl-8">
                    {price !== null ? (
                      <span className="vfig">{formatCurrency(price)}</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>

                  <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right font-mono text-sm text-cream whitespace-nowrap pl-8">
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
