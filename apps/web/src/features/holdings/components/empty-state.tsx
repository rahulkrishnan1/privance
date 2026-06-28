"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/index";

type EmptyStateProps = {
  onAdd: () => void;
};

export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className="text-center py-20 px-6">
      <div className="w-[84px] h-[84px] rounded-full border border-dashed border-cream/20 flex items-center justify-center text-accent mx-auto mb-7">
        <Plus size={30} strokeWidth={1.5} />
      </div>
      <h2 className="font-serif text-4xl font-normal tracking-[-0.01em]">
        Track your <span className="italic text-accent">portfolio.</span>
      </h2>
      <p className="text-dim max-w-[42ch] mx-auto mt-3 text-base">
        Add a holding to track individual stock or crypto positions across your investment accounts.
        Live prices, day deltas, and your real cost basis.
      </p>
      <Button type="button" variant="primary" onClick={onAdd} className="mt-7">
        Add holding
      </Button>
    </div>
  );
}
