"use client";

import { Decimal, SCALE_CENTS, SCALE_CRYPTO } from "@privance/core";
import type { KeyboardEvent, MouseEvent } from "react";
import { formatCurrency } from "@/lib/format";
import { parseCostBasisCents } from "../_helpers";
import type { LocalGroup, LocalHolding } from "../types";
import { GroupChip } from "./group-chips";

type PriceEntry = {
  ticker: string;
  price: string;
};

type HoldingRowProps = {
  holding: LocalHolding;
  accountName: string;
  groups: LocalGroup[];
  prices: Map<string, PriceEntry>;
  onEdit: () => void;
  onDelete: () => void;
  /** True when this row's mobile detail sub-row is open. Ignored on desktop. */
  isExpanded: boolean;
  /** Toggles the mobile detail sub-row open/closed. */
  onToggle: () => void;
};

function formatShares(sharesMajor: string, sharesScale: number): string {
  try {
    const d = Decimal.fromString(sharesMajor, sharesScale);
    return d.toFloat().toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  } catch {
    return sharesMajor;
  }
}

function computeMarketValue(
  sharesMajor: string,
  sharesScale: number,
  priceStr: string,
  scaleFactor?: string,
): Decimal | null {
  try {
    const shares = Decimal.fromString(sharesMajor, sharesScale);
    const price = Decimal.fromString(priceStr, SCALE_CRYPTO);
    const scale = scaleFactor ? Decimal.fromString(scaleFactor, SCALE_CRYPTO) : null;
    const effectivePrice = scale !== null ? price.mul(scale, { resultScale: SCALE_CRYPTO }) : price;
    return shares.mul(effectivePrice, { resultScale: SCALE_CENTS });
  } catch {
    return null;
  }
}

function computeAvgCostPerShare(
  costBasisCents: string,
  sharesMajor: string,
  sharesScale: number,
): Decimal | null {
  try {
    const cost = parseCostBasisCents(costBasisCents);
    const shares = Decimal.fromString(sharesMajor, sharesScale);
    if (shares.isZero()) return null;
    return cost.div(shares);
  } catch {
    return null;
  }
}

function computeGain(
  marketValue: Decimal,
  costBasisCents: string,
): { gainDollar: Decimal; gainPct: number | null } | null {
  try {
    const cost = parseCostBasisCents(costBasisCents);
    const gainDollar = marketValue.sub(cost);
    // Float ratio for display only. Decimal.div at scale 2 truncates to whole
    // percent precision, which makes every percent end in ".00".
    const gainPct = cost.isZero() ? null : gainDollar.toFloat() / cost.toFloat();
    return { gainDollar, gainPct };
  } catch {
    return null;
  }
}

function computeEffectivePrice(priceStr: string, scaleFactor?: string): Decimal | null {
  try {
    const p = Decimal.fromString(priceStr, SCALE_CRYPTO);
    if (scaleFactor === undefined) return p;
    const sf = Decimal.fromString(scaleFactor, SCALE_CRYPTO);
    return p.mul(sf, { resultScale: SCALE_CRYPTO });
  } catch {
    return null;
  }
}

function formatPrice(price: Decimal): string {
  return price.toFloat().toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedPct(pct: number): string {
  const value = pct * 100;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatSignedCurrency(d: Decimal): string {
  const float = d.toFloat();
  const sign = float > 0 ? "+" : float < 0 ? "" : "";
  // formatCurrency handles the leading "-" itself for negatives.
  return `${sign}${formatCurrency(d, "USD")}`;
}

export function HoldingRow({
  holding,
  accountName,
  groups,
  prices,
  onEdit,
  onDelete,
  isExpanded,
  onToggle,
}: HoldingRowProps) {
  const priceTicker = holding.proxyTicker ?? holding.ticker;
  const priceEntry = prices.get(priceTicker);

  const marketValue = priceEntry
    ? computeMarketValue(
        holding.sharesMajor,
        holding.sharesScale,
        priceEntry.price,
        holding.scaleFactor,
      )
    : null;

  const effectivePrice = priceEntry
    ? computeEffectivePrice(priceEntry.price, holding.scaleFactor)
    : null;

  const avgCost = computeAvgCostPerShare(
    holding.costBasisCents,
    holding.sharesMajor,
    holding.sharesScale,
  );

  const gain = marketValue ? computeGain(marketValue, holding.costBasisCents) : null;

  const holdingGroups = groups.filter((g) => g.id === holding.groupId);

  const gainTone =
    gain === null
      ? "text-app-dim"
      : gain.gainDollar.isZero()
        ? "text-app-muted"
        : gain.gainDollar.isNegative()
          ? "text-app-red"
          : "text-app-green";

  const subRowId = `holding-detail-${holding.id}`;
  const totalCost = parseCostBasisCents(holding.costBasisCents);

  // Edit/Delete buttons sit inside the clickable row. stopPropagation keeps
  // them from also toggling row expansion when the user means "edit", not
  // "expand". onClick handlers preserved unchanged on the buttons.
  const onActionClick = (handler: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    handler();
  };

  // Keyboard activation matches the mouse path for the row-as-button.
  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <>
      <tr
        className="border-b border-app-line-soft hover:bg-white/[0.03] cursor-pointer md:cursor-default focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold-accent"
        onClick={onToggle}
        onKeyDown={onRowKeyDown}
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={subRowId}
      >
        {/* Ticker + name */}
        <td className="px-3 py-3">
          <p className="font-mono text-[13px] text-app-text truncate">{holding.ticker}</p>
          {holding.name !== undefined && (
            <p className="text-xs text-app-muted truncate">{holding.name}</p>
          )}
        </td>

        {/* Account chip */}
        <td className="hidden md:table-cell px-3 py-3">
          <span className="inline-block rounded-full bg-white/5 px-2 py-0.5 text-xs text-app-muted truncate max-w-full">
            {accountName}
          </span>
        </td>

        {/* Shares */}
        <td className="hidden md:table-cell px-3 py-3 text-right">
          <span className="font-mono text-[14px] tabular-nums text-app-text">
            {formatShares(holding.sharesMajor, holding.sharesScale)}
          </span>
        </td>

        {/* Avg cost */}
        <td className="hidden md:table-cell px-3 py-3 text-right">
          <span className="font-mono text-[14px] tabular-nums text-app-text">
            {avgCost ? formatCurrency(avgCost, "USD") : "-"}
          </span>
        </td>

        {/* Current price (effective, anchored if proxy) */}
        <td className="hidden md:table-cell px-3 py-3 text-right">
          <span className="font-mono text-[14px] tabular-nums text-app-text">
            {effectivePrice ? formatPrice(effectivePrice) : "-"}
          </span>
        </td>

        {/* Market value */}
        <td className="px-3 py-3 text-right">
          <span className="font-mono text-[14px] tabular-nums text-app-text font-semibold">
            {marketValue ? formatCurrency(marketValue, "USD") : "-"}
          </span>
        </td>

        {/* Gain $ */}
        <td className="hidden md:table-cell px-3 py-3 text-right">
          <span className={`font-mono text-[14px] tabular-nums font-medium ${gainTone}`}>
            {gain ? formatSignedCurrency(gain.gainDollar) : "-"}
          </span>
        </td>

        {/* Gain % */}
        <td className="px-3 py-3 text-right">
          <span className={`font-mono text-[14px] tabular-nums font-medium ${gainTone}`}>
            {gain && gain.gainPct !== null ? formatSignedPct(gain.gainPct) : "-"}
          </span>
        </td>

        {/* Group chips */}
        <td className="hidden md:table-cell px-3 py-3">
          <div className="flex flex-wrap gap-1">
            {holdingGroups.map((g) => (
              <GroupChip key={g.id} group={g} />
            ))}
          </div>
        </td>

        {/* Actions */}
        <td className="hidden md:table-cell px-3 py-3">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onActionClick(onEdit)}
              aria-label={`Edit ${holding.ticker}`}
              className="px-2 py-1 rounded hover:bg-white/[0.03] text-xs text-gold-accent font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] min-h-9 cursor-pointer"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onActionClick(onDelete)}
              aria-label={`Delete ${holding.ticker}`}
              className="px-2 py-1 rounded hover:bg-white/[0.03] text-xs text-app-red font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] min-h-9 cursor-pointer"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr id={subRowId} className="md:hidden border-b border-app-line-soft bg-white/[0.02]">
          <td colSpan={3} className="px-3 py-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim self-center">
                Account
              </dt>
              <dd className="text-[13px] text-app-text text-right truncate">{accountName}</dd>

              <dt className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim self-center">
                Shares
              </dt>
              <dd className="font-mono text-[13px] tabular-nums text-app-text text-right">
                {formatShares(holding.sharesMajor, holding.sharesScale)}
              </dd>

              <dt className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim self-center">
                Price
              </dt>
              <dd className="font-mono text-[13px] tabular-nums text-app-text text-right">
                {effectivePrice ? formatPrice(effectivePrice) : "-"}
              </dd>

              <dt className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim self-center">
                Avg Cost
              </dt>
              <dd className="font-mono text-[13px] tabular-nums text-app-text text-right">
                {avgCost ? formatCurrency(avgCost, "USD") : "-"}
              </dd>

              <dt className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim self-center">
                Total Cost
              </dt>
              <dd className="font-mono text-[13px] tabular-nums text-app-text text-right">
                {formatCurrency(totalCost, "USD")}
              </dd>

              <dt className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim self-center">
                G/L $
              </dt>
              <dd
                className={`font-mono text-[13px] tabular-nums font-medium text-right ${gainTone}`}
              >
                {gain ? formatSignedCurrency(gain.gainDollar) : "-"}
              </dd>
            </dl>

            {holdingGroups.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {holdingGroups.map((g) => (
                  <GroupChip key={g.id} group={g} />
                ))}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-app-line-soft flex justify-end gap-2">
              <button
                type="button"
                onClick={onActionClick(onEdit)}
                aria-label={`Edit ${holding.ticker}`}
                className="px-3 py-1.5 rounded text-[13px] text-gold-accent font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] min-h-9 cursor-pointer"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onActionClick(onDelete)}
                aria-label={`Delete ${holding.ticker}`}
                className="px-3 py-1.5 rounded text-[13px] text-app-red font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] min-h-9 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
