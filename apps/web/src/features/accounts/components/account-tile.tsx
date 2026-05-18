"use client";

import type { Account, AccountKind } from "@privance/core";
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

function formatBalance(account: Account): { text: string; isNegative: boolean } {
  const raw = getBalanceCents(account);
  const d = centsToDecimal(raw);
  const isLiability = account.payload.kind === "liability";
  const displayStr = isLiability ? `-${formatCurrency(d.abs())}` : formatCurrency(d);
  return { text: displayStr, isNegative: isLiability };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AccountTileProps = {
  account: Account;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
};

export function AccountTile({ account, onEdit, onDelete }: AccountTileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const Icon = KIND_ICONS[account.payload.kind];
  const { text: balanceText, isNegative } = formatBalance(account);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`${account.payload.name}, click for options`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none min-h-11 cursor-pointer"
      >
        {/* Kind icon */}
        <div className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
          <Icon size={20} className="text-neutral-600 dark:text-neutral-400" />
        </div>

        {/* Account name + currency */}
        <div className="flex-1 text-left min-w-0">
          <p className="text-sm font-bold text-neutral-900 dark:text-neutral-50 truncate">
            {account.payload.name}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {account.payload.currency}
          </p>
        </div>

        {/* Balance */}
        <span
          className={[
            "font-mono text-sm font-bold",
            isNegative ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-50",
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
          <div className="absolute right-2 top-14 z-20 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-md min-w-32 overflow-hidden">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onEdit(account);
              }}
              aria-label={`Edit ${account.payload.name}`}
              className="w-full px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 text-sm text-neutral-900 dark:text-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400 focus-visible:outline-none min-h-11"
            >
              Edit
            </button>
            <div className="h-px bg-neutral-200 dark:bg-neutral-700" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDelete(account);
              }}
              aria-label={`Delete ${account.payload.name}`}
              className="w-full px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 text-sm text-red-600 dark:text-red-400 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400 focus-visible:outline-none min-h-11"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
