"use client";

import type { Account, Decimal } from "@privance/core";
import { formatCurrency } from "@/lib/format";
import { centsToDecimal, getBalanceCents } from "../queries";
import type { KindMeta } from "../types";
import { AccountTile } from "./account-tile";

type AccountSectionProps = {
  meta: KindMeta;
  accounts: Account[];
  /** Per-account total value override (cash + holdings for investment accounts). */
  valuesByAccount?: Map<string, Decimal>;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
};

export function AccountSection({
  meta,
  accounts,
  valuesByAccount,
  onEdit,
  onDelete,
}: AccountSectionProps) {
  if (accounts.length === 0) return null;

  const subtotal = accounts.reduce((acc, a) => {
    const amount = valuesByAccount?.get(a.id) ?? centsToDecimal(getBalanceCents(a));
    return a.payload.kind === "liability" ? acc.sub(amount) : acc.add(amount);
  }, centsToDecimal("0"));

  const subtotalStr = formatCurrency(subtotal);
  const isNegativeSubtotal = subtotal.isNegative();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-baseline px-1 pb-2 border-b border-app-line">
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
          {meta.label}
        </span>
        <span
          className={[
            "font-editorial text-[16px] tracking-[-0.005em]",
            isNegativeSubtotal ? "text-app-red" : "text-app-muted",
          ].join(" ")}
        >
          {subtotalStr}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {accounts.map((account) => (
          <AccountTile
            key={account.id}
            account={account}
            {...(valuesByAccount?.get(account.id) !== undefined
              ? { displayValue: valuesByAccount.get(account.id) as Decimal }
              : {})}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
