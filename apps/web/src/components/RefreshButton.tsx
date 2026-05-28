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
        "inline-flex items-center justify-center gap-2 min-h-9 px-4 py-2 sm:min-h-10 sm:px-5 rounded-full border text-[13px] sm:text-sm font-medium tracking-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer disabled:cursor-not-allowed",
        disabled
          ? "border-app-line opacity-50"
          : "border-gold-accent/40 text-gold-accent hover:bg-gold-accent/[0.06]",
      ].join(" ")}
    >
      <RefreshCw
        size={14}
        className={[
          refreshing ? "animate-spin text-gold-accent" : "",
          disabled && !refreshing ? "text-app-dim" : "text-gold-accent",
        ].join(" ")}
      />
      <span className={disabled ? "text-app-dim" : "text-gold-accent"}>
        {inCooldown ? `${secondsLeft}s` : "Refresh"}
      </span>
    </button>
  );
}
