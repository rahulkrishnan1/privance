"use client";

import type { Account, AccountKind, Decimal } from "@privance/core";
import { CreditCard, Home, TrendingUp, Wallet } from "lucide-react";
import { useRef, useState } from "react";
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
  const currency = account.payload.currency;
  const isLiability = account.payload.kind === "liability";
  // Normal liability (positive stored value) = debt, display as -$X.
  // Credit balance (negative stored value) = overpayment, display as $X (no sign).
  const isNegativeDisplay = isLiability && !d.isNegative();
  const displayStr = isLiability
    ? isNegativeDisplay
      ? `-${formatCurrency(d.abs(), currency)}`
      : formatCurrency(d.abs(), currency)
    : formatCurrency(d, currency);
  return { text: displayStr, isNegative: isNegativeDisplay };
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

// Estimated menu height in px (2 items * min-h-11 + divider).
const MENU_ESTIMATED_HEIGHT = 92;

export function AccountTile({ account, displayValue, onEdit, onDelete }: AccountTileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFlipUp, setMenuFlipUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const Icon = KIND_ICONS[account.payload.kind];
  const { text: balanceText, isNegative } = formatBalance(account, displayValue);

  function openMenu() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuFlipUp(rect.bottom + MENU_ESTIMATED_HEIGHT > window.innerHeight);
    }
    setMenuOpen(true);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
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
          <div
            className={`absolute right-2 z-20 bg-app-panel border border-app-line rounded-lg shadow-md min-w-32 overflow-hidden ${menuFlipUp ? "bottom-14" : "top-14"}`}
          >
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
