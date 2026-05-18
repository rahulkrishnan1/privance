"use client";

import Link from "next/link";

/**
 * Shown when the user has no accounts yet.
 */
export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 flex flex-col items-center">
        <span className="text-4xl mb-4" aria-hidden="true">
          💼
        </span>
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50 mb-2 text-center">
          Welcome to Privance
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6 text-center">
          Add your first account to start tracking your net worth.
        </p>
        <Link
          href="/accounts"
          className="rounded-lg bg-gold-600 hover:bg-gold-700 px-6 py-3 text-white text-base font-semibold text-center w-full focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:outline-none"
          aria-label="Add account"
        >
          Add account
        </Link>
      </div>
    </div>
  );
}
