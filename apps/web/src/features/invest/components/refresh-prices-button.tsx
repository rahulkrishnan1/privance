"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useCooldown } from "@/lib/use-cooldown";

/**
 * Top-bar icon button that refetches market prices, subject to the server-side
 * refresh cooldown. Styled to match the Veil and Lock controls beside it.
 */
export function RefreshPricesButton() {
  const queryClient = useQueryClient();
  const { cooldownMs, refresh: refreshCooldown } = useCooldown();
  const [refreshing, setRefreshing] = useState(false);
  const disabled = refreshing || cooldownMs > 0;

  const onRefresh = useCallback(async () => {
    if (disabled) return;
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["prices"] });
    } finally {
      setRefreshing(false);
      refreshCooldown();
    }
  }, [disabled, queryClient, refreshCooldown]);

  return (
    <button
      type="button"
      onClick={() => void onRefresh()}
      disabled={disabled}
      aria-label="Refresh prices"
      title={cooldownMs > 0 ? "Prices recently refreshed" : "Refresh prices"}
      className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-line text-dim transition-colors cursor-pointer hover:border-accent-dim hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-default"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}
