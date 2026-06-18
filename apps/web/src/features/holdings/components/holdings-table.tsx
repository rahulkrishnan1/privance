"use client";

import type { Decimal } from "@privance/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { LocalHolding, SortColumn, SortState } from "../types";
import { EmptyState } from "./empty-state";
import { HoldingRow } from "./holding-row";
import { SkeletonRows } from "./skeleton-row";

type PriceEntry = {
  ticker: string;
  price: string;
};

type HoldingsTableProps = {
  holdings: LocalHolding[];
  prices: Map<string, PriceEntry>;
  sort: SortState;
  loading: boolean;
  onSortChange: (column: SortColumn) => void;
  onRowClick: (holding: LocalHolding) => void;
  onAdd: () => void;
  dayChangeByHoldingId: ReadonlyMap<string, Decimal>;
  totalInvestmentsCents: Decimal | null;
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
        "flex items-center gap-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:rounded-[inherit] rounded cursor-pointer w-full min-h-[44px] md:min-h-0",
        isRight ? "justify-end" : "justify-start",
      ].join(" ")}
    >
      <span
        className={[
          "font-mono text-[9.5px] tracking-[.16em] uppercase whitespace-nowrap font-normal",
          active ? "text-accent" : "text-faint",
        ].join(" ")}
      >
        {label}
      </span>
      {active && sort.direction === "asc" ? (
        <ChevronUp size={10} className="text-accent" />
      ) : active ? (
        <ChevronDown size={10} className="text-accent" />
      ) : null}
    </button>
  );
}

export function HoldingsTable({
  holdings,
  prices,
  sort,
  loading,
  onSortChange,
  onRowClick,
  onAdd,
  dayChangeByHoldingId,
  totalInvestmentsCents,
}: HoldingsTableProps) {
  if (loading) {
    return (
      <div className="overflow-x-auto">
        <table aria-label="Holdings" className="w-full">
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

  return (
    <div className="overflow-x-auto">
      <table aria-label="Holdings" className="w-full">
        <thead>
          <tr>
            <th scope="col" className="text-left pb-3">
              <SortableHeader column="ticker" label="Holding" sort={sort} onPress={onSortChange} />
            </th>
            <th scope="col" className="hidden md:table-cell text-right pb-3">
              <SortableHeader
                column="currentPrice"
                label="Price"
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="hidden md:table-cell text-right pb-3">
              <SortableHeader
                column="dayPct"
                label="Day"
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="text-right pb-3">
              <SortableHeader
                column="gainDollar"
                label="G/L"
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="hidden md:table-cell text-right pb-3">
              <SortableHeader
                column="weight"
                label="Weight"
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
            <th scope="col" className="text-right pb-3">
              <SortableHeader
                column="marketValue"
                label="Value"
                sort={sort}
                onPress={onSortChange}
                align="right"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => (
            <HoldingRow
              key={holding.id}
              holding={holding}
              prices={prices}
              dayChangeCents={dayChangeByHoldingId.get(holding.id) ?? null}
              totalInvestmentsCents={totalInvestmentsCents}
              onRowClick={onRowClick}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
