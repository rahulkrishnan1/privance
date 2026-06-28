"use client";

import type { Account, Decimal, HoldingValuation } from "@privance/core";
import { useState } from "react";
import { Button, CloseButton } from "@/components";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CASH_TYPE_LABEL, SUBKIND_TYPE_LABEL } from "@/features/accounts";
import { formatAccountBalanceWhole } from "@/features/accounts/balance";
import { centsToDecimal } from "@/features/accounts/queries";
import { formatCurrencyWhole, formatPercent } from "@/lib/format";
import { SUBKIND_TAG } from "../_constants";

type HoldingInAccount = {
  id: string;
  ticker: string;
  name?: string;
  valueCents: Decimal;
};

type AccountDetailSheetProps = {
  account: Account;
  totalValue: Decimal;
  holdingValuations: HoldingValuation[];
  holdingsByAccount: HoldingInAccount[];
  onClose: () => void;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => Promise<void>;
};

function AccountTypeTag({ account }: { account: Account }) {
  let label: string | null = null;
  if (account.payload.kind === "investment") {
    const { subKind } = account.payload;
    const tag = SUBKIND_TAG[subKind];
    const typeLabel = SUBKIND_TYPE_LABEL[subKind] ?? "Investment";
    label = `${typeLabel} · ${tag}`;
  } else if (account.payload.kind === "cash") {
    label = CASH_TYPE_LABEL[account.payload.subKind] ?? null;
  }
  if (label === null) return null;
  return <p className="font-mono text-sm text-accent tracking-[.08em]">{label.toUpperCase()}</p>;
}

export function AccountDetailSheet({
  account,
  totalValue,
  holdingValuations,
  holdingsByAccount,
  onClose,
  onEdit,
  onDelete,
}: AccountDetailSheetProps) {
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isInvestment = account.payload.kind === "investment";
  const sweepCents = isInvestment ? centsToDecimal(account.payload.cashBalanceCents) : null;

  let accountGainCents = centsToDecimal("0");
  let accountCostBasis = centsToDecimal("0");
  for (const hv of holdingValuations) {
    accountGainCents = accountGainCents.add(hv.unrealizedPnl);
    accountCostBasis = accountCostBasis.add(hv.costBasis);
  }
  const hasGain = isInvestment && !accountGainCents.isZero();
  const gainPositive = !accountGainCents.isNegative();
  const gainPct = accountCostBasis.isZero()
    ? 0
    : accountGainCents.toFloat() / accountCostBasis.toFloat();

  async function handleDelete() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      setTimeout(() => setDeleteArmed(false), 3500);
      return;
    }
    setDeleting(true);
    try {
      await onDelete(account);
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
            <AccountTypeTag account={account} />
            <SheetTitle asChild>
              <h3 className="font-serif text-3xl font-light tracking-[-0.01em] mt-1.5">
                {account.payload.name}
              </h3>
            </SheetTitle>
          </div>
          <CloseButton onClick={onClose} label="Close account details" />
        </div>

        <p
          data-testid="account-detail-value"
          className="vfig font-serif text-5xl mt-4 tracking-[-0.01em]"
        >
          {formatAccountBalanceWhole(account, totalValue).text}
        </p>

        {hasGain && (
          <p className={`font-mono text-xs mt-1.5 ${gainPositive ? "text-up" : "text-down"}`}>
            {gainPositive ? "+" : ""}
            {formatCurrencyWhole(accountGainCents)} unrealized &middot;{" "}
            {formatPercent(gainPct, { signed: true })}
          </p>
        )}

        {account.payload.kind === "cash" && account.payload.apy && (
          <div className="flex justify-between items-center mt-3">
            <span className="font-mono text-xs text-faint tracking-[.06em]">APY</span>
            <span className="font-mono text-sm text-cream tabular-nums">
              {(Number(account.payload.apy) * 100).toFixed(2)}%
            </span>
          </div>
        )}

        {account.payload.kind === "investment" && account.payload.apy && (
          <div className="flex justify-between items-center mt-3">
            <span className="font-mono text-xs text-faint tracking-[.06em]">Cash APY</span>
            <span className="font-mono text-sm text-cream tabular-nums">
              {(Number(account.payload.apy) * 100).toFixed(2)}%
            </span>
          </div>
        )}

        {account.payload.kind === "liability" && account.payload.interestRate && (
          <div className="flex justify-between items-center mt-3">
            <span className="font-mono text-xs text-faint tracking-[.06em]">Rate</span>
            <span className="font-mono text-sm text-cream tabular-nums">
              {(Number(account.payload.interestRate) * 100).toFixed(2)}%
            </span>
          </div>
        )}
        {account.payload.kind === "liability" && account.payload.termYearsRemaining && (
          <div className="flex justify-between items-center mt-3">
            <span className="font-mono text-xs text-faint tracking-[.06em]">Term remaining</span>
            <span className="font-mono text-sm text-cream tabular-nums">
              {Number(account.payload.termYearsRemaining)}y
            </span>
          </div>
        )}

        {account.payload.kind === "manual_asset" && account.payload.valuedAt && (
          <div className="flex justify-between items-center mt-3">
            <span className="font-mono text-xs text-faint tracking-[.06em]">Valued</span>
            <span className="font-mono text-sm text-cream">
              {new Date(`${account.payload.valuedAt}T00:00:00`).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
        )}

        {holdingsByAccount.length > 0 && (
          <>
            <p className="font-mono text-xs tracking-label uppercase text-faint mt-6 mb-0.5">
              Holdings &middot; {holdingsByAccount.length}
              {sweepCents !== null && !sweepCents.isZero() ? " + cash" : ""}
            </p>
            {holdingsByAccount.map((h) => (
              <div
                key={h.id}
                className="flex justify-between py-2.5 border-b border-line-soft text-sm"
              >
                <span className="font-mono text-cream tracking-[.04em]">{h.ticker}</span>
                <span className="vfig font-mono text-sm tabular-nums">
                  {formatCurrencyWhole(h.valueCents)}
                </span>
              </div>
            ))}
            {sweepCents !== null && !sweepCents.isZero() && (
              <div className="flex justify-between py-2.5 border-b border-line-soft text-sm">
                <span className="text-dim">Cash</span>
                <span className="vfig font-mono text-sm tabular-nums">
                  {formatCurrencyWhole(sweepCents)}
                </span>
              </div>
            )}
          </>
        )}

        <div className="flex gap-2.5 mt-6">
          <Button variant="secondary" onClick={() => onEdit(account)} className="flex-1">
            Edit account
          </Button>
          <Button
            variant={deleteArmed ? "danger" : "dangerOutline"}
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="flex-1"
          >
            {deleteArmed ? "Tap again to delete" : "Delete"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
