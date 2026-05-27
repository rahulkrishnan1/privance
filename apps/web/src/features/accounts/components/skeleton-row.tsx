"use client";

/**
 * Placeholder tile that matches the visual shape of an AccountTile.
 * Uses animate-pulse shimmer to signal loading without a spinner.
 */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-app-panel rounded-xl border border-app-line">
      {/* Icon placeholder */}
      <div className="w-10 h-10 rounded-full bg-white/5 animate-pulse" />
      <div className="flex-1 flex flex-col gap-2">
        {/* Name bar */}
        <div className="h-4 w-3/5 rounded bg-white/5 animate-pulse" />
        {/* Currency label */}
        <div className="h-3 w-1/4 rounded bg-white/5 animate-pulse" />
      </div>
      {/* Balance shimmer */}
      <div className="h-4 w-20 rounded bg-white/5 animate-pulse" />
    </div>
  );
}
