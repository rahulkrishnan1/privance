"use client";

import Link from "next/link";

/**
 * Shown when the user has no accounts yet.
 */
export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm rounded-xl border border-app-line bg-app-panel p-8 flex flex-col items-center">
        <span className="text-4xl mb-4" aria-hidden="true">
          💼
        </span>
        <h2 className="text-xl font-semibold text-app-text mb-2 text-center">
          Welcome to Privance
        </h2>
        <p className="text-sm text-app-muted mb-6 text-center">
          Add your first account to start tracking your net worth.
        </p>
        <Link
          href="/app/accounts"
          className="rounded-lg bg-gold-600 hover:bg-gold-700 px-6 py-3 text-white text-base font-semibold text-center w-full focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:outline-none"
          aria-label="Add account"
        >
          Add account
        </Link>
      </div>
    </div>
  );
}
