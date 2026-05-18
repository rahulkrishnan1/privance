"use client";

import { TrendingUp } from "lucide-react";
import { Button } from "@/components/index";

type EmptyStateProps = {
  onAdd: () => void;
};

export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="rounded-full bg-gold-100 dark:bg-gold-900 p-5">
        <TrendingUp size={40} className="text-gold-600" />
      </div>
      <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        No holdings yet
      </h2>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center px-8">
        Add your first holding to start tracking your portfolio across investment accounts.
      </p>
      <Button onClick={onAdd} aria-label="Add holding" size="lg">
        Add holding
      </Button>
    </div>
  );
}
