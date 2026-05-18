"use client";

import type { Account, AccountKind } from "@privance/core";
import { Button } from "@/components/index";
import { formatCurrency } from "@/lib/format";
import { centsToDecimal, getBalanceCents } from "../queries";
import type { KindMeta } from "../types";
import { AccountTile } from "./account-tile";

type AccountSectionProps = {
  kind: AccountKind;
  meta: KindMeta;
  accounts: Account[];
  onAdd: (kind: AccountKind) => void;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
};

/**
 * One section in the accounts list, grouped by account kind.
 * Renders a sticky header with the kind label and balance subtotal,
 * followed by tiles or an empty-state ghost button.
 */
export function AccountSection({
  kind,
  meta,
  accounts,
  onAdd,
  onEdit,
  onDelete,
}: AccountSectionProps) {
  const subtotal = accounts.reduce((acc, a) => {
    const amount = centsToDecimal(getBalanceCents(a));
    return a.payload.kind === "liability" ? acc.sub(amount) : acc.add(amount);
  }, centsToDecimal("0"));

  const subtotalStr = formatCurrency(subtotal);
  const isNegativeSubtotal = subtotal.isNegative();

  return (
    <div className="flex flex-col gap-2">
      {/* Section header */}
      <div className="flex justify-between items-center px-1 py-2 bg-neutral-50 dark:bg-neutral-950">
        <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
          {meta.label}
        </span>
        <span
          className={[
            "font-mono text-xs font-semibold",
            isNegativeSubtotal
              ? "text-red-600 dark:text-red-400"
              : "text-neutral-700 dark:text-neutral-300",
          ].join(" ")}
        >
          {subtotalStr}
        </span>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 flex items-center justify-center py-6">
          <Button variant="ghost" onClick={() => onAdd(kind)} aria-label={meta.addLabel}>
            {meta.addLabel}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map((account) => (
            <AccountTile key={account.id} account={account} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
