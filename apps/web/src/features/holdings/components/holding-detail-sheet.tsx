"use client";

import type { Decimal } from "@privance/core";
import { useState } from "react";
import { Button, CloseButton, ConfirmDeleteButton } from "@/components";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { formatCurrency, formatPercentMagnitude, formatTrendCurrency } from "@/lib/format";
import {
  computeAvgCost,
  computeEffectivePrice,
  computeMarketValue,
  formatShares,
  parseCostBasisCents,
} from "../_helpers";
import type { LocalHolding } from "../types";

type PriceEntry = {
  ticker: string;
  price: string;
};

type HoldingDetailSheetProps = {
  holding: LocalHolding;
  prices: Map<string, PriceEntry>;
  dayChangeCents: Decimal | null;
  totalInvestmentsCents: Decimal | null;
  accountName: string;
  onClose: () => void;
  onEdit: (holding: LocalHolding) => void;
  onDelete: (holding: LocalHolding) => Promise<void>;
};

function formatPrice(price: Decimal): string {
  return price.toFloat().toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function HoldingDetailSheet({
  holding,
  prices,
  dayChangeCents,
  totalInvestmentsCents,
  accountName,
  onClose,
  onEdit,
  onDelete,
}: HoldingDetailSheetProps) {
  const [deleting, setDeleting] = useState(false);

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

  const costBasis = (() => {
    try {
      return parseCostBasisCents(holding.costBasisCents);
    } catch {
      return null;
    }
  })();

  const avgCostBasis = computeAvgCost(holding);

  const unrealizedGain =
    marketValue !== null && costBasis !== null ? marketValue.sub(costBasis) : null;
  const unrealizedPct =
    unrealizedGain !== null && costBasis !== null && !costBasis.isZero()
      ? unrealizedGain.toFloat() / costBasis.toFloat()
      : null;
  const gainPositive =
    unrealizedGain !== null && !unrealizedGain.isNegative() && !unrealizedGain.isZero();
  const gainTone = unrealizedGain === null ? "text-faint" : gainPositive ? "text-up" : "text-down";

  // Day change %: change / prior value (prior = marketValue - change).
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
  const dayTone =
    dayChangeCents === null || dayChangeCents.isZero()
      ? "text-dim"
      : dayPositive
        ? "text-up"
        : "text-down";

  const weightPct =
    marketValue !== null && totalInvestmentsCents !== null && !totalInvestmentsCents.isZero()
      ? (marketValue.toFloat() / totalInvestmentsCents.toFloat()) * 100
      : null;

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(holding);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent>
        <div className="flex justify-between items-start">
          <div>
            <SheetTitle asChild>
              <p className="font-mono text-base text-cream tracking-[.08em]">{holding.ticker}</p>
            </SheetTitle>
            {holding.proxyTicker ? (
              <p className="font-mono text-sm text-dim tracking-[.04em] mt-1.5">
                Proxy: {holding.proxyTicker}
              </p>
            ) : (
              holding.name !== undefined && (
                <h3 className="font-serif text-3xl font-light tracking-[-0.01em] mt-1">
                  {holding.name}
                </h3>
              )
            )}
          </div>
          <CloseButton onClick={onClose} label="Close holding details" />
        </div>

        {marketValue !== null ? (
          <p
            data-testid="holding-detail-value"
            className="vfig font-serif text-5xl mt-4 tracking-[-0.01em]"
          >
            {formatCurrency(marketValue, "USD")}
          </p>
        ) : (
          <p className="font-mono text-sm text-faint mt-4">no price, set one</p>
        )}

        {unrealizedGain !== null && (
          <p className={`font-mono text-sm mt-1.5 ${gainTone}`}>
            <span className="vfig">{formatTrendCurrency(unrealizedGain)}</span>
            {unrealizedPct !== null
              ? ` (${formatPercentMagnitude(unrealizedPct)}) unrealized`
              : " unrealized"}
          </p>
        )}

        <p className="font-mono text-xs tracking-label uppercase text-faint mt-6 mb-1.5">
          Position
        </p>

        <div className="flex justify-between py-2 border-b border-line-soft text-sm">
          <span className="text-dim">Day</span>
          <span className={`font-mono text-sm tabular-nums ${dayTone}`}>
            {dayChangeCents === null ? (
              "-"
            ) : (
              <>
                <span className="vfig">{formatTrendCurrency(dayChangeCents)}</span>
                {dayPct !== null && ` (${formatPercentMagnitude(dayPct)})`}
              </>
            )}
          </span>
        </div>

        <div className="flex justify-between py-2 border-b border-line-soft text-sm">
          <span className="text-dim">Price</span>
          <span className="font-mono text-sm tabular-nums">
            {effectivePrice ? formatPrice(effectivePrice) : "-"}
          </span>
        </div>

        <div className="flex justify-between py-2 border-b border-line-soft text-sm">
          <span className="text-dim">Quantity</span>
          <span className="vfig font-mono text-sm tabular-nums">
            {formatShares(holding.sharesMajor, holding.sharesScale)}
          </span>
        </div>

        <div className="flex justify-between py-2 border-b border-line-soft text-sm">
          <span className="text-dim">Avg cost basis</span>
          <span className="vfig font-mono text-sm tabular-nums">
            {avgCostBasis !== null
              ? avgCostBasis.toLocaleString("en-US", { style: "currency", currency: "USD" })
              : "-"}
          </span>
        </div>

        <div className="flex justify-between py-2 border-b border-line-soft text-sm">
          <span className="text-dim">Total cost basis</span>
          <span className="vfig font-mono text-sm tabular-nums">
            {costBasis !== null ? formatCurrency(costBasis, "USD") : "-"}
          </span>
        </div>

        <div className="flex justify-between py-2 border-b border-line-soft text-sm">
          <span className="text-dim">Portfolio weight</span>
          <span className="font-mono text-sm tabular-nums">
            {weightPct !== null ? `${weightPct.toFixed(1)}%` : "-"}
          </span>
        </div>

        <div className="flex justify-between py-2 border-b border-line-soft text-sm">
          <span className="text-dim">Account</span>
          <span className="text-sm text-cream-soft">{accountName}</span>
        </div>

        <div className="flex gap-2.5 mt-6">
          <Button variant="secondary" onClick={() => onEdit(holding)} className="flex-1">
            Edit holding
          </Button>
          <ConfirmDeleteButton
            onConfirm={() => void handleDelete()}
            pending={deleting}
            className="flex-1"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
