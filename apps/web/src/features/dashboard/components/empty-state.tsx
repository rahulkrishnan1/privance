"use client";

import { TrendingUp } from "lucide-react";
import Link from "next/link";

export function EmptyState() {
  return (
    <div className="flex justify-center pt-2 md:pt-4 pb-16">
      <div className="w-full max-w-xl flex flex-col items-center text-center gap-6">
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.24em] uppercase text-gold-accent">
          <span className="w-1 h-1 rounded-full bg-gold-accent" />
          Welcome to Privance
        </div>
        <div className="w-[84px] h-[84px] rounded-full border border-gold-accent/20 bg-[radial-gradient(circle_at_50%_35%,rgba(230,211,154,0.10),rgba(230,211,154,0.02))] flex items-center justify-center text-gold-accent mb-2">
          <TrendingUp size={32} strokeWidth={1.25} />
        </div>
        <div className="flex flex-col gap-3">
          <h1
            className="font-serif text-[36px] leading-tight font-light tracking-[-0.018em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            Track your <span className="font-editorial italic text-gold-accent">net worth.</span>
          </h1>
          <p className="text-[14px] text-app-muted max-w-[380px] mx-auto leading-relaxed">
            Add an account to start tracking your net worth. Everything stays encrypted on your
            device.
          </p>
        </div>
        <Link
          href="/app/accounts"
          className="inline-flex items-center justify-center rounded-full bg-gold-accent text-app-bg hover:bg-gold-accent-hover px-7 py-3 text-sm font-medium tracking-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] mb-6"
        >
          Add your first account
        </Link>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-7 pt-7 border-t border-app-line-soft w-full max-w-[520px] text-left">
          <div>
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent block mb-1.5">
              Step 01
            </span>
            <p className="text-[13px] font-medium text-app-text mb-1">Add accounts</p>
            <p className="text-[12px] text-app-muted leading-relaxed">
              Cash, investment, manual assets, liabilities.
            </p>
          </div>
          <div>
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent block mb-1.5">
              Step 02
            </span>
            <p className="text-[13px] font-medium text-app-text mb-1">Add holdings</p>
            <p className="text-[12px] text-app-muted leading-relaxed">
              Track stocks and crypto across your investment accounts.
            </p>
          </div>
          <div>
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent block mb-1.5">
              Step 03
            </span>
            <p className="text-[13px] font-medium text-app-text mb-1">See it together</p>
            <p className="text-[12px] text-app-muted leading-relaxed">
              Watch your net worth, allocation, and history grow over time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
