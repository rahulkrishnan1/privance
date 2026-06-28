"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { RoundIconButton } from "@/components";
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
    <RoundIconButton
      onClick={() => void onRefresh()}
      label="Refresh prices"
      title={cooldownMs > 0 ? "Prices recently refreshed" : "Refresh prices"}
      disabled={disabled}
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
    </RoundIconButton>
  );
}
