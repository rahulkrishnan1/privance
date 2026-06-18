"use client";

import type { Account, Decimal, HoldingValuation } from "@privance/core";
import { X } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/Modal";
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
  return (
    <p className="font-mono text-[13px] text-accent tracking-[.08em]">{label.toUpperCase()}</p>
  );
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
    <Modal open onClose={onClose} variant="sheet">
      <div className="flex justify-between items-start">
        <div>
          <AccountTypeTag account={account} />
          <h3 className="font-serif text-[25px] font-light tracking-[-0.01em] mt-1.5">
            {account.payload.name}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close account details"
          className="text-faint hover:text-cream text-[18px] leading-none p-1 cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      <p
        data-testid="account-detail-value"
        className="vfig font-serif text-[38px] mt-4 tracking-[-0.01em]"
      >
        {formatAccountBalanceWhole(account, totalValue).text}
      </p>

      {hasGain && (
        <p className={`font-mono text-[11px] mt-1.5 ${gainPositive ? "text-up" : "text-down"}`}>
          {gainPositive ? "+" : ""}
          {formatCurrencyWhole(accountGainCents)} unrealized &middot;{" "}
          {formatPercent(gainPct, { signed: true })}
        </p>
      )}

      {account.payload.kind === "cash" && account.payload.apy && (
        <div className="flex justify-between items-center mt-3">
          <span className="font-mono text-[10.5px] text-faint tracking-[.06em]">APY</span>
          <span className="font-mono text-[12px] text-cream tabular-nums">
            {(Number(account.payload.apy) * 100).toFixed(2)}%
          </span>
        </div>
      )}

      {account.payload.kind === "investment" && account.payload.apy && (
        <div className="flex justify-between items-center mt-3">
          <span className="font-mono text-[10.5px] text-faint tracking-[.06em]">Cash APY</span>
          <span className="font-mono text-[12px] text-cream tabular-nums">
            {(Number(account.payload.apy) * 100).toFixed(2)}%
          </span>
        </div>
      )}

      {account.payload.kind === "liability" && account.payload.interestRate && (
        <div className="flex justify-between items-center mt-3">
          <span className="font-mono text-[10.5px] text-faint tracking-[.06em]">Rate</span>
          <span className="font-mono text-[12px] text-cream tabular-nums">
            {(Number(account.payload.interestRate) * 100).toFixed(2)}%
          </span>
        </div>
      )}
      {account.payload.kind === "liability" && account.payload.termYearsRemaining && (
        <div className="flex justify-between items-center mt-3">
          <span className="font-mono text-[10.5px] text-faint tracking-[.06em]">
            Term remaining
          </span>
          <span className="font-mono text-[12px] text-cream tabular-nums">
            {Number(account.payload.termYearsRemaining)}y
          </span>
        </div>
      )}

      {account.payload.kind === "manual_asset" && account.payload.valuedAt && (
        <div className="flex justify-between items-center mt-3">
          <span className="font-mono text-[10.5px] text-faint tracking-[.06em]">Valued</span>
          <span className="font-mono text-[12px] text-cream">
            {new Date(`${account.payload.valuedAt}T00:00:00`).toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      )}

      {holdingsByAccount.length > 0 && (
        <>
          <p className="font-mono text-[9px] tracking-[.2em] uppercase text-faint mt-6 mb-0.5">
            Holdings &middot; {holdingsByAccount.length}
            {sweepCents !== null && !sweepCents.isZero() ? " + cash" : ""}
          </p>
          {holdingsByAccount.map((h) => (
            <div
              key={h.id}
              className="flex justify-between py-2.5 border-b border-line-soft text-[13px]"
            >
              <span className="font-mono text-cream tracking-[.04em]">{h.ticker}</span>
              <span className="vfig font-mono text-[12.5px] tabular-nums">
                {formatCurrencyWhole(h.valueCents)}
              </span>
            </div>
          ))}
          {sweepCents !== null && !sweepCents.isZero() && (
            <div className="flex justify-between py-2.5 border-b border-line-soft text-[13px]">
              <span className="text-dim">Cash</span>
              <span className="vfig font-mono text-[12.5px] tabular-nums">
                {formatCurrencyWhole(sweepCents)}
              </span>
            </div>
          )}
        </>
      )}

      <div className="flex gap-2.5 mt-6">
        <button
          type="button"
          onClick={() => onEdit(account)}
          className="flex-1 font-mono text-[11px] tracking-[.14em] uppercase text-dim border border-line rounded-lg py-3.5 cursor-pointer hover:text-cream transition-colors"
        >
          Edit account
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
