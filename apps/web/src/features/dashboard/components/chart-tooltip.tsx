"use client";

import type { Decimal } from "@privance/core";
import { formatCurrency, formatDate } from "@/lib/format";

export type TooltipPayloadEntry = {
  value?: number;
  payload?: { date?: string; value?: Decimal };
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
};

/**
 * Custom Recharts tooltip styled to match the app's Card aesthetic.
 */
export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0];
  const decimal = entry?.payload?.value;
  const dateStr = entry?.payload?.date ?? label ?? "";

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 shadow-sm">
      {dateStr ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">{formatDate(dateStr)}</p>
      ) : null}
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
        {decimal !== undefined ? formatCurrency(decimal) : "-"}
      </p>
    </div>
  );
}
