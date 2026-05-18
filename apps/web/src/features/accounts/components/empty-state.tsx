"use client";

import { PiggyBank } from "lucide-react";
import { Button } from "@/components/index";

type EmptyStateProps = {
  onAdd: () => void;
};

/**
 * Full-screen empty state shown when the user has no accounts at all.
 */
export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-16">
      <PiggyBank size={64} className="text-neutral-300 dark:text-neutral-700" />
      <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50 text-center">
        Add your first account
      </h2>
      <p className="text-base text-neutral-500 dark:text-neutral-400 text-center">
        Start by adding a cash or investment account. Manual assets and liabilities are optional.
      </p>
      <Button onClick={onAdd} aria-label="Add your first account">
        Add account
      </Button>
    </div>
  );
}
