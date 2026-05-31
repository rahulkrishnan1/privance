"use client";

import type { InvestmentAccount } from "@privance/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useCallback, useState } from "react";
import type { LocalGroup, LocalHolding, SortColumn, SortState } from "../types";
import { EmptyState } from "./empty-state";
import { HoldingRow } from "./holding-row";
import { SkeletonRows } from "./skeleton-row";

type PriceEntry = {
  ticker: string;
  price: string;
};

type HoldingsTableProps = {
  holdings: LocalHolding[];
  groups: LocalGroup[];
  accounts: InvestmentAccount[];
  prices: Map<string, PriceEntry>;
  sort: SortState;
  loading: boolean;
  onSortChange: (column: SortColumn) => void;
  onEdit: (holding: LocalHolding) => void;
  onDelete: (holding: LocalHolding) => void;
  onAdd: () => void;
};

const COLUMN_LABELS: Record<SortColumn, string> = {
  ticker: "Ticker",
  account: "Account",
  shares: "Shares",
  avgCost: "Avg Cost",
  currentPrice: "Price",
  marketValue: "Value",
  gainDollar: "Total G/L $",
  gainPct: "Total G/L %",
};

type SortableHeaderProps = {
  column: SortColumn;
  label: string;
  sort: SortState;
  onPress: (column: SortColumn) => void;
  align?: "left" | "right";
};

function SortableHeader({ column, label, sort, onPress, align = "left" }: SortableHeaderProps) {
  const active = sort.column === column;
  const isRight = align === "right";

  return (
    <button
      type="button"
      onClick={() => onPress(column)}
      aria-label={`Sort by ${label}`}
      aria-pressed={active}
      className={[
        "flex items-center gap-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] rounded cursor-pointer w-full min-h-[44px] md:min-h-0",
        isRight ? "justify-end" : "justify-start",
      ].join(" ")}
    >
      <span
        className={[
          "font-mono text-[10px] tracking-[0.22em] uppercase whitespace-nowrap",
          active ? "text-gold-accent" : "text-app-dim",
        ].join(" ")}
      >
        {label}
      </span>
      {active && sort.direction === "asc" ? (
        <ChevronUp size={10} className="text-gold-accent" />
      ) : active ? (
        <ChevronDown size={10} className="text-gold-accent" />
      ) : null}
    </button>
  );
}

function accountName(accounts: InvestmentAccount[], accountId: string): string {
  return accounts.find((a) => a.id === accountId)?.payload.name ?? "Unknown";
}

export function HoldingsTable({
  holdings,
  groups,
  accounts,
  prices,
  sort,
  loading,
  onSortChange,
  onEdit,
  onDelete,
  onAdd,
}: HoldingsTableProps) {
  // Single row expanded at a time on mobile. Desktop ignores this state
  // (the expanded sub-row is hidden via md:hidden) since every column is
  // already visible there.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Stable across renders so HoldingRow does not see a fresh closure each tick.
  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table aria-label="Holdings" className="w-full md:min-w-[960px]">
          <tbody>
            <SkeletonRows count={5} />
          </tbody>
        </table>
      </div>
    );
  }

  if (holdings.length === 0) {
    return <EmptyState onAdd={onAdd} />;
  }

  // Mobile shows three columns (Ticker, Value, G/L %); the rest collapse
  // behind a row tap that reveals the detail sub-row. Desktop sees every
  // column directly. tabular-nums on numeric cells keeps digits column-aligned.
  //
  // Note: don't use a <colgroup> here. JSX whitespace between <col> tags
  // becomes hydrated text nodes that React rejects inside colgroup.
  return (
    <div className="overflow-x-auto">
      <table aria-label="Holdings" className="w-full md:min-w-[960px]">
        <thead>
          <tr className="border-b border-app-line">
            <th scope="col" className="px-3 py-2 text-left">
              <SortableHeader
                column="ticker"
                label={COLUMN_LABELS.ticker}
                sort={sort}
                onPress={onSortChange}
              />
            </th>
            <th scope="col" className="hidden md:table-cell px-3 py-2 text-left">
              <SortableHeader
                column="account"
                label={COLUMN_LABELS.account}
                sort={sort}
                onPress={onSortChange}
              />
            </th>
            <th scope="col" className="hidden md:table-cell px-3 py-2 text-right">
              <SortableHeader
                column="shares"
                label={COLUMN_LABELS.shares}
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="hidden md:table-cell px-3 py-2 text-right">
              <SortableHeader
                column="currentPrice"
                label={COLUMN_LABELS.currentPrice}
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="hidden md:table-cell px-3 py-2 text-right">
              <SortableHeader
                column="avgCost"
                label={COLUMN_LABELS.avgCost}
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              <SortableHeader
                column="marketValue"
                label={COLUMN_LABELS.marketValue}
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="hidden md:table-cell px-3 py-2 text-right">
              <SortableHeader
                column="gainDollar"
                label={COLUMN_LABELS.gainDollar}
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              <SortableHeader
                column="gainPct"
                label={COLUMN_LABELS.gainPct}
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="hidden md:table-cell px-3 py-2 text-left">
              <span className="flex items-center font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim whitespace-nowrap">
                Groups
              </span>
            </th>
            <th scope="col" className="hidden md:table-cell px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <HoldingRow
              key={holding.id}
              holding={holding}
              accountName={accountName(accounts, holding.accountId)}
              groups={groups}
              prices={prices}
              onEdit={onEdit}
              onDelete={onDelete}
              isExpanded={expandedId === holding.id}
              onToggle={handleToggle}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
