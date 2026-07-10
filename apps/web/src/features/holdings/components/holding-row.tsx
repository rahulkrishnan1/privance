"use client";

import type { Decimal } from "@privance/core";
import type { KeyboardEvent } from "react";
import { ChangePill, type ChangeTone } from "@/components/ui/change-pill";
import { formatCurrency } from "@/lib/format";
import {
  computeAvgCost,
  computeEffectivePrice,
  computeMarketValue,
  getTotalCost,
  parseCostBasisCents,
} from "../_helpers";
import type { LocalHolding } from "../types";

type PriceEntry = {
  ticker: string;
  price: string;
};

type HoldingRowProps = {
  holding: LocalHolding;
  prices: Map<string, PriceEntry>;
  /** Day change in cents for this holding; null when prior price not available. */
  dayChangeCents: Decimal | null;
  /** Total investment portfolio value in cents; used to compute weight. */
  totalInvestmentsCents: Decimal | null;
  /** Called when the row is clicked to open the detail sheet. */
  onRowClick: (holding: LocalHolding) => void;
};

function computeGain(
  marketValue: Decimal,
  costBasisCents: string,
): { gainDollar: Decimal; gainPct: number | null } | null {
  try {
    const cost = parseCostBasisCents(costBasisCents);
    const gainDollar = marketValue.sub(cost);
    // Float ratio for display only; Decimal.div at scale 2 truncates to whole
    // percent precision, which makes every percent end in ".00".
    const gainPct = cost.isZero() ? null : gainDollar.toFloat() / cost.toFloat();
    return { gainDollar, gainPct };
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
  const sign = float > 0 ? "+" : "";
  return `${sign}${formatCurrency(d, "USD")}`;
}

export function HoldingRow({
  holding,
  prices,
  dayChangeCents,
  totalInvestmentsCents,
  onRowClick,
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

  const gain = marketValue ? computeGain(marketValue, holding.costBasisCents) : null;

  const gainPositive = gain !== null && !gain.gainDollar.isNegative() && !gain.gainDollar.isZero();
  const gainNegative = gain?.gainDollar.isNegative();
  const gainTone = gainPositive ? "text-up" : gainNegative ? "text-down" : "text-faint";
  const gainPillTone: ChangeTone = gainPositive ? "up" : gainNegative ? "down" : "flat";

  // Require prior > marketValue / 10000 to avoid division by near-zero.
  const dayPct: number | null = (() => {
    if (dayChangeCents === null || marketValue === null) return null;
    const prior = marketValue.sub(dayChangeCents);
    if (prior.isNegative() || prior.toMinorUnits() * 10000n <= marketValue.toMinorUnits())
      return null;
    return dayChangeCents.toFloat() / prior.toFloat();
  })();

  const dayPositive =
    dayChangeCents !== null && !dayChangeCents.isNegative() && !dayChangeCents.isZero();
  const dayZero = dayChangeCents === null || dayChangeCents.isZero();
  const dayTone =
    dayChangeCents === null
      ? "text-faint"
      : dayZero
        ? "text-dim"
        : dayPositive
          ? "text-up"
          : "text-down";
  const dayPillTone: ChangeTone = dayZero ? "flat" : dayPositive ? "up" : "down";

  const weightPct: number | null = (() => {
    if (marketValue === null || totalInvestmentsCents === null || totalInvestmentsCents.isZero())
      return null;
    return (marketValue.toFloat() / totalInvestmentsCents.toFloat()) * 100;
  })();

  const avgCost = computeAvgCost(holding);
  const totalCost = getTotalCost(holding);

  const noPrice = priceEntry === undefined;

  const handleClick = () => onRowClick(holding);
  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick(holding);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <tr> must stay for table layout; role=button adds AT announcement for the interactive row
    <tr
      role="button"
      className="hover:bg-white/[0.015] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      onClick={handleClick}
      onKeyDown={onRowKeyDown}
      tabIndex={0}
      aria-label={`${holding.ticker}, open holding details`}
    >
      {/* Holding: ticker (cream, mono) + name, or "Proxy: TICKER" when proxied */}
      <td className="border-t border-line-soft py-[13px] tabular-nums text-left max-w-0">
        <div className="font-mono text-sm tracking-[.04em] text-cream truncate">
          {holding.ticker}
        </div>
        {holding.proxyTicker ? (
          <div className="hidden md:block font-mono text-xs text-dim mt-0.5 truncate">
            Proxy: {holding.proxyTicker}
          </div>
        ) : (
          holding.name !== undefined && (
            <div className="hidden md:block text-xs text-dim mt-0.5 truncate">{holding.name}</div>
          )
        )}
      </td>

      {/* Day -- desktop only: dollar over percent (mobile shows G/L instead) */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right whitespace-nowrap pl-8">
        {noPrice ? (
          <span className="font-mono text-sm text-faint">—</span>
        ) : (
          <span className={`inline-flex flex-col items-end font-mono ${dayTone}`}>
            <span className="vfig text-sm">
              {dayChangeCents !== null ? formatSignedCurrency(dayChangeCents) : "—"}
            </span>
            {dayPct !== null && (
              <ChangePill tone={dayPillTone} className="mt-1">
                {formatSignedPct(dayPct)}
              </ChangePill>
            )}
          </span>
        )}
      </td>

      <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right whitespace-nowrap pl-8">
        {noPrice ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="vfig font-mono text-sm text-cream">
            {effectivePrice ? formatPrice(effectivePrice) : "—"}
          </span>
        )}
      </td>

      {/* Avg cost -- desktop only; derived from cost basis, independent of price */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right whitespace-nowrap pl-8">
        <span className="vfig font-mono text-sm text-cream-soft">
          {avgCost !== null
            ? avgCost.toLocaleString("en-US", { style: "currency", currency: "USD" })
            : "—"}
        </span>
      </td>

      {/* G/L -- percent only on mobile, dollar over percent on desktop */}
      <td className="border-t border-line-soft py-[13px] tabular-nums text-right whitespace-nowrap pl-8">
        {noPrice || gain === null ? (
          <span className="text-faint">—</span>
        ) : (
          <>
            <ChangePill tone={gainPillTone} size="sm" className="md:hidden">
              {gain.gainPct !== null ? formatSignedPct(gain.gainPct) : "—"}
            </ChangePill>
            <span className={`hidden md:inline-flex flex-col items-end font-mono ${gainTone}`}>
              <span className="vfig text-sm">{formatSignedCurrency(gain.gainDollar)}</span>
              {gain.gainPct !== null && (
                <ChangePill tone={gainPillTone} className="mt-1">
                  {formatSignedPct(gain.gainPct)}
                </ChangePill>
              )}
            </span>
          </>
        )}
      </td>

      {/* Total cost -- desktop only; the stored total cost basis */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right whitespace-nowrap pl-8">
        <span className="vfig font-mono text-sm text-cream-soft">
          {totalCost !== null ? formatCurrency(totalCost, "USD") : "—"}
        </span>
      </td>

      <td
        data-testid="holding-value"
        className="border-t border-line-soft py-[13px] tabular-nums text-right whitespace-nowrap pl-8"
      >
        {noPrice ? (
          <span className="font-mono text-xs tracking-[.08em] uppercase text-down border border-down/30 rounded-[5px] px-2 py-1 whitespace-nowrap">
            no price, set one
          </span>
        ) : (
          <span className="vfig font-mono text-sm text-cream">
            {marketValue ? formatCurrency(marketValue, "USD") : "—"}
          </span>
        )}
      </td>

      {/* Weight -- hidden on mobile, last column */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right whitespace-nowrap pl-8">
        {noPrice || weightPct === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="font-mono text-sm text-cream">{weightPct.toFixed(1)}%</span>
        )}
      </td>
    </tr>
  );
}
