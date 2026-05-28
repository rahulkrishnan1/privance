"use client";

import type { Account, AccountKind, Decimal } from "@privance/core";
import { CreditCard, Home, TrendingUp, Wallet } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import { centsToDecimal, getBalanceCents } from "../queries";

// ---------------------------------------------------------------------------
// Icon per kind
// ---------------------------------------------------------------------------

const KIND_ICONS: Record<AccountKind, typeof Wallet> = {
  cash: Wallet,
  investment: TrendingUp,
  manual_asset: Home,
  liability: CreditCard,
};

// ---------------------------------------------------------------------------
// Balance formatter
// ---------------------------------------------------------------------------

function formatBalance(
  account: Account,
  override: Decimal | undefined,
): { text: string; isNegative: boolean } {
  const d = override ?? centsToDecimal(getBalanceCents(account));
  const isLiability = account.payload.kind === "liability";
  const displayStr = isLiability ? `-${formatCurrency(d.abs())}` : formatCurrency(d);
  return { text: displayStr, isNegative: isLiability };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AccountTileProps = {
  account: Account;
  /** Total value override (cash + holdings for investment accounts). */
  displayValue?: Decimal;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
};

export function AccountTile({ account, displayValue, onEdit, onDelete }: AccountTileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = KIND_ICONS[account.payload.kind];
  const { text: balanceText, isNegative } = formatBalance(account, displayValue);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`${account.payload.name}, click for options`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="w-full flex items-center gap-3 px-4 py-3 bg-app-panel rounded-xl border border-app-line hover:bg-white/[0.03] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] min-h-11 cursor-pointer"
      >
        {/* Kind icon */}
        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center shrink-0">
          <Icon size={20} className="text-app-muted" />
        </div>

        {/* Account name + currency */}
        <div className="flex-1 text-left min-w-0">
          <p className="text-[14px] font-medium text-app-text truncate">{account.payload.name}</p>
          <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-app-dim">
            {account.payload.currency}
          </p>
        </div>

        {/* Balance */}
        <span
          className={[
            "font-editorial text-[22px] font-normal tracking-[-0.01em]",
            isNegative ? "text-app-red" : "text-app-text",
          ].join(" ")}
        >
          {balanceText}
        </span>
      </button>

      {/* Context menu */}
      {menuOpen && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-2 top-14 z-20 bg-app-panel border border-app-line rounded-lg shadow-md min-w-32 overflow-hidden">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onEdit(account);
              }}
              aria-label={`Edit ${account.payload.name}`}
              className="w-full px-4 py-3 text-left hover:bg-white/[0.03] text-sm text-app-text focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-gold-accent min-h-11"
            >
              Edit
            </button>
            <div className="h-px bg-app-line" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDelete(account);
              }}
              aria-label={`Delete ${account.payload.name}`}
              className="w-full px-4 py-3 text-left hover:bg-white/[0.03] text-sm text-app-red focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-gold-accent min-h-11"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
