"use client";

import { Decimal, SCALE_CENTS, SCALE_CRYPTO } from "@privance/core";
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
      ? "text-neutral-400 dark:text-neutral-600"
      : gain.gainDollar.isZero()
        ? "text-neutral-500"
        : gain.gainDollar.isNegative()
          ? "text-red-600 dark:text-red-400"
          : "text-emerald-600 dark:text-emerald-400";

  return (
    <tr className="border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
      {/* Ticker + name */}
      <td className="px-3 py-3">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 truncate">
          {holding.ticker}
        </p>
        {holding.name !== undefined && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{holding.name}</p>
        )}
      </td>

      {/* Account chip */}
      <td className="px-3 py-3">
        <span className="inline-block rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 truncate max-w-full">
          {accountName}
        </span>
      </td>

      {/* Shares */}
      <td className="px-3 py-3 text-right">
        <span className="text-sm font-mono text-neutral-900 dark:text-neutral-50 tabular-nums">
          {formatShares(holding.sharesMajor, holding.sharesScale)}
        </span>
      </td>

      {/* Avg cost */}
      <td className="px-3 py-3 text-right">
        <span className="text-sm text-neutral-700 dark:text-neutral-300 tabular-nums">
          {avgCost ? formatCurrency(avgCost, "USD") : "-"}
        </span>
      </td>

      {/* Current price (effective, anchored if proxy) */}
      <td className="px-3 py-3 text-right">
        <span className="text-sm text-neutral-700 dark:text-neutral-300 tabular-nums">
          {effectivePrice ? formatPrice(effectivePrice) : "-"}
        </span>
      </td>

      {/* Market value */}
      <td className="px-3 py-3 text-right">
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 tabular-nums">
          {marketValue ? formatCurrency(marketValue, "USD") : "-"}
        </span>
      </td>

      {/* Gain $ */}
      <td className="px-3 py-3 text-right">
        <span className={`text-sm font-medium tabular-nums ${gainTone}`}>
          {gain ? formatSignedCurrency(gain.gainDollar) : "-"}
        </span>
      </td>

      {/* Gain % */}
      <td className="px-3 py-3 text-right">
        <span className={`text-sm font-medium tabular-nums ${gainTone}`}>
          {gain?.gainPct ? formatSignedPct(gain.gainPct) : "-"}
        </span>
      </td>

      {/* Group chips */}
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {holdingGroups.map((g) => (
            <GroupChip key={g.id} group={g} />
          ))}
        </div>
      </td>

      {/* Actions */}
      <td className="px-3 py-3">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${holding.ticker}`}
            className="px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs text-gold-600 dark:text-gold-400 font-medium focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none min-h-9 cursor-pointer"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${holding.ticker}`}
            className="px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs text-red-600 dark:text-red-400 font-medium focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none min-h-9 cursor-pointer"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
