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
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 shadow-sm">
      {dateStr ? <p className="font-mono text-xs text-faint mb-1">{formatDate(dateStr)}</p> : null}
      <p className="vfig font-mono text-sm text-cream">
        {decimal !== undefined ? formatCurrency(decimal) : "-"}
      </p>
    </div>
  );
}
