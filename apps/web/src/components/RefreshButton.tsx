"use client";

import { RefreshCw } from "lucide-react";

type RefreshButtonProps = {
  cooldownMs: number;
  onRefresh: () => void;
  refreshing: boolean;
};

export function RefreshButton({ cooldownMs, onRefresh, refreshing }: RefreshButtonProps) {
  const inCooldown = cooldownMs > 0;
  const secondsLeft = Math.ceil(cooldownMs / 1000);
  const disabled = inCooldown || refreshing;

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={disabled}
      aria-label={
        refreshing
          ? "Refreshing prices"
          : inCooldown
            ? `Refresh available in ${secondsLeft}s`
            : "Refresh prices"
      }
      aria-disabled={disabled}
      className={[
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none cursor-pointer disabled:cursor-not-allowed",
        disabled
          ? "border-neutral-200 dark:border-neutral-800 opacity-50"
          : "border-gold-300 dark:border-gold-700 hover:bg-gold-50 dark:hover:bg-gold-950",
      ].join(" ")}
    >
      <RefreshCw
        size={14}
        className={[
          refreshing ? "animate-spin text-gold-600" : "",
          disabled && !refreshing ? "text-neutral-400" : "text-gold-600",
        ].join(" ")}
      />
      <span
        className={[
          "text-xs font-medium",
          disabled ? "text-neutral-400 dark:text-neutral-600" : "text-gold-600 dark:text-gold-400",
        ].join(" ")}
      >
        {inCooldown ? `${secondsLeft}s` : "Refresh"}
      </span>
    </button>
  );
}
