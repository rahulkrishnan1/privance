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
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border focus-visible:ring-2 focus-visible:ring-gold-accent/40 focus-visible:outline-none cursor-pointer disabled:cursor-not-allowed",
        disabled
          ? "border-app-line opacity-50"
          : "border-gold-accent/30 hover:bg-gold-accent/[0.06]",
      ].join(" ")}
    >
      <RefreshCw
        size={14}
        className={[
          refreshing ? "animate-spin text-gold-accent" : "",
          disabled && !refreshing ? "text-app-dim" : "text-gold-accent",
        ].join(" ")}
      />
      <span
        className={["text-xs font-medium", disabled ? "text-app-dim" : "text-gold-accent"].join(
          " ",
        )}
      >
        {inCooldown ? `${secondsLeft}s` : "Refresh"}
      </span>
    </button>
  );
}
