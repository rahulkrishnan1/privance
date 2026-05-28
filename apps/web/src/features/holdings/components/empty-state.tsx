"use client";

import { TrendingUp } from "lucide-react";
import { Button } from "@/components/index";

type EmptyStateProps = {
  onAdd: () => void;
};

export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className="flex justify-center pt-2 md:pt-4 pb-16">
      <div className="w-full max-w-md flex flex-col items-center text-center gap-6">
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.24em] uppercase text-gold-accent">
          <span className="w-1 h-1 rounded-full bg-gold-accent" />
          No holdings yet
        </div>
        <div className="w-[84px] h-[84px] rounded-full border border-gold-accent/20 bg-[radial-gradient(circle_at_50%_35%,rgba(230,211,154,0.10),rgba(230,211,154,0.02))] flex items-center justify-center text-gold-accent mb-2">
          <TrendingUp size={32} strokeWidth={1.25} />
        </div>
        <div className="flex flex-col gap-3">
          <h1
            className="font-serif text-[36px] leading-tight font-light tracking-[-0.018em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            Track your <span className="font-editorial italic text-gold-accent">portfolio.</span>
          </h1>
          <p className="text-[14px] text-app-muted leading-relaxed">
            Add a holding to track individual stock or crypto positions across your investment
            accounts. Live prices, day deltas, and your real cost basis.
          </p>
        </div>
        <Button onClick={onAdd} aria-label="Add holding">
          Add holding
        </Button>
      </div>
    </div>
  );
}
