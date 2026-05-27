"use client";

import type { InvestmentAccount } from "@privance/core";
import { ChevronDown, ChevronUp } from "lucide-react";
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
  marketValue: "Market Value",
  gainDollar: "Gain $",
  gainPct: "Gain %",
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
        "flex items-center gap-0.5 focus-visible:ring-2 focus-visible:ring-gold-accent/40 focus-visible:outline-none rounded cursor-pointer w-full",
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
  if (loading) {
    return (
      <table aria-label="Holdings" className="min-w-full">
        <tbody>
          <SkeletonRows count={5} />
        </tbody>
      </table>
    );
  }

  if (holdings.length === 0) {
    return <EmptyState onAdd={onAdd} />;
  }

  // table-auto sizes columns to content; setting min-w on the table prevents
  // narrow ticker names from squashing the wider numeric columns. The row uses
  // tabular-nums on numeric cells so digits align column-to-column.
  //
  // Note: don't use a <colgroup> here. JSX whitespace between <col> tags
  // becomes hydrated text nodes that React rejects inside colgroup.
  return (
    <div className="overflow-x-auto">
      <table aria-label="Holdings" className="w-full min-w-[960px]">
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
            <th scope="col" className="px-3 py-2 text-left">
              <SortableHeader
                column="account"
                label={COLUMN_LABELS.account}
                sort={sort}
                onPress={onSortChange}
              />
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              <SortableHeader
                column="shares"
                label={COLUMN_LABELS.shares}
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="px-3 py-2 text-right">
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
                column="currentPrice"
                label={COLUMN_LABELS.currentPrice}
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
            <th scope="col" className="px-3 py-2 text-right">
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
            <th scope="col" className="px-3 py-2 text-left">
              <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
                Groups
              </span>
            </th>
            <th scope="col" className="px-3 py-2" />
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
              onEdit={() => onEdit(holding)}
              onDelete={() => onDelete(holding)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
