"use client";

import { Wallet } from "lucide-react";
import { Button } from "@/components/index";

type EmptyStateProps = {
  onAdd: () => void;
};

export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className="flex justify-center pt-2 md:pt-4 pb-16">
      <div className="w-full max-w-xl flex flex-col items-center text-center gap-6">
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.24em] uppercase text-gold-accent">
          <span className="w-1 h-1 rounded-full bg-gold-accent" />
          No accounts yet
        </div>
        <div className="w-[84px] h-[84px] rounded-full border border-gold-accent/20 bg-[radial-gradient(circle_at_50%_35%,rgba(230,211,154,0.10),rgba(230,211,154,0.02))] flex items-center justify-center text-gold-accent mb-2">
          <Wallet size={32} strokeWidth={1.25} />
        </div>
        <div className="flex flex-col gap-3">
          <h1
            className="font-serif text-[36px] leading-tight font-light tracking-[-0.018em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            Add your first <span className="font-editorial italic text-gold-accent">account.</span>
          </h1>
          <p className="text-[14px] text-app-muted max-w-[380px] mx-auto leading-relaxed">
            Track cash, investments, manual assets, or liabilities. Any account type works to begin.
          </p>
        </div>
        <Button onClick={onAdd} aria-label="Add your first account" className="mb-6">
          Add account
        </Button>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-7 w-full max-w-[520px] text-left">
          <div>
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent block mb-1.5">
              Cash
            </span>
            <p className="text-[13px] font-medium text-app-text mb-1">Checking, Savings</p>
            <p className="text-[12px] text-app-muted leading-relaxed">
              Liquid balances that contribute to your net worth.
            </p>
          </div>
          <div>
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent block mb-1.5">
              Investment
            </span>
            <p className="text-[13px] font-medium text-app-text mb-1">Brokerage, IRA</p>
            <p className="text-[12px] text-app-muted leading-relaxed">
              Account-level balance plus per-holding positions.
            </p>
          </div>
          <div>
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent block mb-1.5">
              Other
            </span>
            <p className="text-[13px] font-medium text-app-text mb-1">Manual Asset, Liability</p>
            <p className="text-[12px] text-app-muted leading-relaxed">
              Property, vehicles, credit-card balances, loans.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
