"use client";

import type { Decimal } from "@privance/core";
import { formatCurrencyParts } from "@/lib/format";

type SummaryTileProps = {
  label: string;
  value: Decimal;
  /** Optional subline (e.g. day-change %). Reserved space stays even if omitted so tiles line up. */
  subline?: React.ReactNode;
};

/** Compact KPI tile that aligns with NetWorthTile across the dashboard header row. */
export function SummaryTile({ label, value, subline }: SummaryTileProps) {
  const { whole, cents } = formatCurrencyParts(value);

  return (
    <div className="rounded-xl border border-app-line bg-app-panel p-5 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">{label}</p>
      </div>

      <p className="font-editorial font-normal tracking-[-0.02em] text-app-text leading-none">
        <span className="text-[40px] sm:text-[44px]">{whole}</span>
        <span className="text-[26px] sm:text-[28px] text-app-dim">{cents}</span>
      </p>

      <div className="h-4">{subline}</div>
    </div>
  );
}
