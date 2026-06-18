"use client";

import { Decimal } from "@privance/core";
import { X } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { formatCurrency } from "@/lib/format";
import { computeEffectivePrice, computeMarketValue, parseCostBasisCents } from "../_helpers";
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
  const [deleteArmed, setDeleteArmed] = useState(false);
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

  // Avg cost basis per share = total cost / shares.
  const avgCostBasis = (() => {
    if (costBasis === null) return null;
    try {
      const shares = Decimal.fromString(holding.sharesMajor, holding.sharesScale);
      return shares.isZero() ? null : costBasis.toFloat() / shares.toFloat();
    } catch {
      return null;
    }
  })();

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
    if (!deleteArmed) {
      setDeleteArmed(true);
      setTimeout(() => setDeleteArmed(false), 3500);
      return;
    }
    setDeleting(true);
    try {
      await onDelete(holding);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal open onClose={onClose} variant="sheet">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-mono text-[16px] text-cream tracking-[.08em]">{holding.ticker}</p>
          {holding.proxyTicker ? (
            <p className="font-mono text-[12.5px] text-dim tracking-[.04em] mt-1.5">
              Proxy &middot; {holding.proxyTicker}
            </p>
          ) : (
            holding.name !== undefined && (
              <h3 className="font-serif text-[25px] font-light tracking-[-0.01em] mt-1">
                {holding.name}
              </h3>
            )
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close holding details"
          className="text-faint hover:text-cream text-[18px] leading-none p-1 cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {marketValue !== null ? (
        <p
          data-testid="holding-detail-value"
          className="vfig font-serif text-[38px] mt-4 tracking-[-0.01em]"
        >
          {formatCurrency(marketValue, "USD")}
        </p>
      ) : (
        <p className="font-mono text-[12px] text-faint mt-4">no price, set one</p>
      )}

      {unrealizedGain !== null && (
        <p className={`font-mono text-[11px] mt-1.5 ${gainTone}`}>
          {unrealizedGain.isNegative() ? "" : "+"}
          {formatCurrency(unrealizedGain, "USD")} unrealized
          {unrealizedPct !== null &&
            ` · ${unrealizedPct >= 0 ? "+" : ""}${(unrealizedPct * 100).toFixed(1)}%`}
        </p>
      )}

      <p className="font-mono text-[9px] tracking-[.2em] uppercase text-faint mt-6 mb-1.5">
        Position
      </p>

      <div className="flex justify-between py-2 border-b border-line-soft text-[13px]">
        <span className="text-dim">Quantity</span>
        <span className="vfig font-mono text-[13px] tabular-nums">
          {formatShares(holding.sharesMajor, holding.sharesScale)}
        </span>
      </div>

      <div className="flex justify-between py-2 border-b border-line-soft text-[13px]">
        <span className="text-dim">Price</span>
        <span className="font-mono text-[13px] tabular-nums">
          {effectivePrice ? formatPrice(effectivePrice) : "-"}
        </span>
      </div>

      <div className="flex justify-between py-2 border-b border-line-soft text-[13px]">
        <span className="text-dim">Day</span>
        <span className={`font-mono text-[13px] tabular-nums ${dayTone}`}>
          {dayChangeCents === null ? (
            "-"
          ) : (
            <>
              <span className="vfig">
                {dayChangeCents.isNegative() ? "" : "+"}
                {formatCurrency(dayChangeCents, "USD")}
              </span>
              {dayPct !== null && ` · ${dayPct >= 0 ? "+" : ""}${(dayPct * 100).toFixed(2)}%`}
            </>
          )}
        </span>
      </div>

      <div className="flex justify-between py-2 border-b border-line-soft text-[13px]">
        <span className="text-dim">Avg cost basis</span>
        <span className="vfig font-mono text-[13px] tabular-nums">
          {avgCostBasis !== null
            ? avgCostBasis.toLocaleString("en-US", { style: "currency", currency: "USD" })
            : "-"}
        </span>
      </div>

      <div className="flex justify-between py-2 border-b border-line-soft text-[13px]">
        <span className="text-dim">Total cost basis</span>
        <span className="vfig font-mono text-[13px] tabular-nums">
          {costBasis !== null ? formatCurrency(costBasis, "USD") : "-"}
        </span>
      </div>

      <div className="flex justify-between py-2 border-b border-line-soft text-[13px]">
        <span className="text-dim">Portfolio weight</span>
        <span className="font-mono text-[13px] tabular-nums">
          {weightPct !== null ? `${weightPct.toFixed(1)}%` : "-"}
        </span>
      </div>

      <div className="flex justify-between py-2 border-b border-line-soft text-[13px]">
        <span className="text-dim">Account</span>
        <span className="text-[13px] text-cream-soft">{accountName}</span>
      </div>

      <div className="flex gap-2.5 mt-6">
        <button
          type="button"
          onClick={() => onEdit(holding)}
          className="flex-1 font-mono text-[11px] tracking-[.14em] uppercase text-dim border border-line rounded-lg py-3.5 cursor-pointer hover:text-cream transition-colors"
        >
          Edit holding
        </button>
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          className={[
            "font-mono text-[11px] tracking-[.14em] uppercase rounded-lg py-3.5 px-4 cursor-pointer border transition-colors",
            deleteArmed
              ? "text-vault bg-down border-down"
              : "text-down border-down/35 hover:bg-down/8",
          ].join(" ")}
        >
          {deleteArmed ? "Tap again to delete" : "Delete"}
        </button>
      </div>
    </Modal>
  );
}
