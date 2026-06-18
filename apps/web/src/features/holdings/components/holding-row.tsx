"use client";

import type { Decimal } from "@privance/core";
import type { KeyboardEvent } from "react";
import { formatCurrency } from "@/lib/format";
import { computeEffectivePrice, computeMarketValue, parseCostBasisCents } from "../_helpers";
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

  const weightPct: number | null = (() => {
    if (marketValue === null || totalInvestmentsCents === null || totalInvestmentsCents.isZero())
      return null;
    return (marketValue.toFloat() / totalInvestmentsCents.toFloat()) * 100;
  })();

  const noPrice = priceEntry === undefined;

  const handleClick = () => onRowClick(holding);
  const onRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick(holding);
    }
  };

  return (
    <tr
      className="hover:bg-white/[0.015] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      onClick={handleClick}
      onKeyDown={onRowKeyDown}
      tabIndex={0}
      aria-label={`${holding.ticker}, open holding details`}
    >
      {/* Holding: ticker (cream, mono) + name, or "Proxy · TICKER" when proxied */}
      <td className="border-t border-line-soft py-[13px] tabular-nums text-left">
        <div className="h-tk font-mono text-[12.5px] tracking-[.04em] text-cream truncate">
          {holding.ticker}
        </div>
        {holding.proxyTicker ? (
          <div className="h-nm hidden md:block font-mono text-[11.5px] text-dim mt-0.5 truncate">
            Proxy &middot; {holding.proxyTicker}
          </div>
        ) : (
          holding.name !== undefined && (
            <div className="h-nm hidden md:block text-[12px] text-dim mt-0.5 truncate">
              {holding.name}
            </div>
          )
        )}
      </td>

      <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right">
        {noPrice ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="vfig h-val font-mono text-[13px] text-cream">
            {effectivePrice ? formatPrice(effectivePrice) : "—"}
          </span>
        )}
      </td>

      {/* Day -- desktop only: dollar over percent (mobile shows G/L instead) */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right">
        {noPrice ? (
          <span className="font-mono text-[12px] text-faint">—</span>
        ) : (
          <span className={`inline-flex flex-col items-end font-mono ${dayTone}`}>
            <span className="vfig text-[13px]">
              {dayChangeCents !== null ? formatSignedCurrency(dayChangeCents) : "—"}
            </span>
            {dayPct !== null && (
              <span className="text-[11px] opacity-80">{formatSignedPct(dayPct)}</span>
            )}
          </span>
        )}
      </td>

      {/* G/L -- percent only on mobile, dollar over percent on desktop */}
      <td className="border-t border-line-soft py-[13px] tabular-nums text-right">
        {noPrice || gain === null ? (
          <span className="text-faint">—</span>
        ) : (
          <>
            <span className={`md:hidden font-mono text-[12px] ${gainTone}`}>
              {gain.gainPct !== null ? formatSignedPct(gain.gainPct) : "—"}
            </span>
            <span
              className={`h-gain hidden md:inline-flex flex-col items-end font-mono ${gainTone}`}
            >
              <span className="vfig text-[13px]">{formatSignedCurrency(gain.gainDollar)}</span>
              {gain.gainPct !== null && (
                <span className="g-pc text-[11px] opacity-80">{formatSignedPct(gain.gainPct)}</span>
              )}
            </span>
          </>
        )}
      </td>

      {/* Weight -- hidden on mobile: thin bar + % */}
      <td className="hidden md:table-cell border-t border-line-soft py-[13px] tabular-nums text-right">
        {noPrice || weightPct === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="h-wt inline-flex items-center gap-[10px] justify-end">
            <span className="wt-bar w-[74px] h-1 rounded-[2px] bg-[rgba(235,235,230,0.08)] overflow-hidden">
              <span
                className="block h-full bg-accent rounded-[2px]"
                style={{ width: `${Math.min(100, weightPct).toFixed(1)}%` }}
                aria-hidden="true"
              />
            </span>
            <span className="wt-pc font-mono text-[11.5px] text-dim w-11 text-right">
              {weightPct.toFixed(1)}%
            </span>
          </span>
        )}
      </td>

      <td className="border-t border-line-soft py-[13px] tabular-nums text-right">
        {noPrice ? (
          <span className="np font-mono text-[9.5px] tracking-[.08em] uppercase text-down border border-down/30 rounded-[5px] px-2 py-1 whitespace-nowrap">
            no price &middot; set one
          </span>
        ) : (
          <span className="vfig h-val font-mono text-[13px] text-cream">
            {marketValue ? formatCurrency(marketValue, "USD") : "—"}
          </span>
        )}
      </td>
    </tr>
  );
}
