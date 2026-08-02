"use client";

import type { Account, Decimal, HoldingValuation } from "@privance/core";
import { useState } from "react";
import { Button, CloseButton, ConfirmDeleteButton } from "@/components";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CASH_TYPE_LABEL, SUBKIND_TYPE_LABEL } from "@/features/accounts";
import { formatAccountBalanceWhole } from "@/features/accounts/balance";
import { centsToDecimal } from "@/features/accounts/queries";
import {
  formatCurrencyWhole,
  formatPercentMagnitude,
  formatTrendCurrencyWhole,
} from "@/lib/format";
import { SUBKIND_TAG } from "../_constants";

type HoldingInAccount = {
  id: string;
  ticker: string;
  name?: string;
  valueCents: Decimal;
};

type AccountDetailSheetProps = {
  open: boolean;
  account: Account | null;
  totalValue: Decimal;
  holdingValuations: HoldingValuation[];
  holdingsByAccount: HoldingInAccount[];
  onClose: () => void;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => Promise<void>;
};

type AccountDetailSheetBodyProps = Omit<AccountDetailSheetProps, "open" | "account"> & {
  account: Account;
};

function AccountTypeTag({ account }: { account: Account }) {
  let label: string | null = null;
  if (account.payload.kind === "investment") {
    const { subKind } = account.payload;
    const tag = SUBKIND_TAG[subKind];
    const typeLabel = SUBKIND_TYPE_LABEL[subKind] ?? "Investment";
    label = `${typeLabel}, ${tag}`;
  } else if (account.payload.kind === "cash") {
    label = CASH_TYPE_LABEL[account.payload.subKind] ?? null;
  }
  if (label === null) return null;
  return <p className="font-mono text-sm text-accent tracking-[.08em]">{label.toUpperCase()}</p>;
}

function AccountDetailSheetBody({
  account,
  totalValue,
  holdingValuations,
  holdingsByAccount,
  onClose,
  onEdit,
  onDelete,
}: AccountDetailSheetBodyProps) {
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

  const sweepApy =
    isInvestment && account.payload.apy
      ? `${(Number(account.payload.apy) * 100).toFixed(2)}%`
      : null;

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(account);
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex justify-between items-start">
        <div>
          <AccountTypeTag account={account} />
          <SheetTitle
            // biome-ignore lint/a11y/useHeadingContent: heading text is injected as children by Base UI's render prop
            render={<h3 className="font-serif text-3xl font-light tracking-[-0.01em] mt-1.5" />}
          >
            {account.payload.name}
          </SheetTitle>
        </div>
        <CloseButton onClick={onClose} label="Close account details" />
      </div>

      <p
        data-testid="account-detail-value"
        className="vfig font-serif text-5xl mt-4 tracking-[-0.01em]"
      >
        {formatAccountBalanceWhole(account, totalValue)}
      </p>

      {hasGain && (
        <p className={`font-mono text-sm mt-1.5 ${gainPositive ? "text-up" : "text-down"}`}>
          {formatTrendCurrencyWhole(accountGainCents)} ({formatPercentMagnitude(gainPct)}){" "}
          unrealized
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
            Holdings ({holdingsByAccount.length})
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
            <div className="flex justify-between items-baseline py-2.5 border-b border-line-soft text-sm">
              <span className="text-dim">
                Cash
                {sweepApy !== null && (
                  <span className="font-mono text-xs text-faint tabular-nums ml-2">
                    {sweepApy} APY
                  </span>
                )}
              </span>
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
        <ConfirmDeleteButton
          onConfirm={() => void handleDelete()}
          pending={deleting}
          className="flex-1"
        />
      </div>
    </>
  );
}

export function AccountDetailSheet({
  open,
  account,
  totalValue,
  holdingValuations,
  holdingsByAccount,
  onClose,
  onEdit,
  onDelete,
}: AccountDetailSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent>
        {account !== null && (
          <AccountDetailSheetBody
            account={account}
            totalValue={totalValue}
            holdingValuations={holdingValuations}
            holdingsByAccount={holdingsByAccount}
            onClose={onClose}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
