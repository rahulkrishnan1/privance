"use client";

import type { Decimal } from "@privance/core";
import { formatCurrency, formatDate } from "@/lib/format";

export type TooltipPayloadEntry = {
  value?: number;
  payload?: {
    date?: string;
    value?: Decimal;
  };
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
};

/** Custom Recharts tooltip styled to match the app's Card aesthetic. */
export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0];
  const pt = entry?.payload;
  const dateStr = pt?.date ?? label ?? "";

  const decimal = pt?.value;

  return (
    <div className="rounded-xl border border-app-line bg-app-panel-2 p-3 shadow-sm">
      {dateStr ? <p className="text-xs text-app-muted mb-1">{formatDate(dateStr)}</p> : null}
      <p className="text-sm font-semibold text-app-text">
        {decimal !== undefined ? formatCurrency(decimal) : "-"}
      </p>
    </div>
  );
}
