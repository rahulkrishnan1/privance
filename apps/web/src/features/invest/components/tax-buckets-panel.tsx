"use client";

import { Decimal, SCALE_CENTS } from "@privance/core";
import { useState } from "react";
import { assignColors } from "@/features/dashboard/palette";
import { formatCurrencyWhole, formatPercent } from "@/lib/format";
import type { TaxBucket } from "../_invest-math";

type TaxBucketsPanelProps = {
  buckets: TaxBucket[];
  reachableBeforeFiftyNineHalfCents: Decimal;
};

export function TaxBucketsPanel({
  buckets,
  reachableBeforeFiftyNineHalfCents,
}: TaxBucketsPanelProps) {
  // Sum in Decimal so the denominator does not drift from float summation; the
  // per-slice width is a display ratio so the final toFloat is at the UI boundary.
  const totalCents = buckets.reduce((sum, b) => sum.add(b.valueCents), Decimal.zero(SCALE_CENTS));
  const total = totalCents.toFloat();
  const colors = assignColors(buckets.map((b) => b.label));
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="bg-panel border border-line rounded-[10px] p-6 h-full">
      <div className="flex justify-between items-baseline mb-4 gap-2.5 flex-wrap">
        <h3 className="font-serif text-2xl font-normal tracking-[-0.005em]">Where it lives</h3>
        <span className="font-mono text-xs tracking-label uppercase text-faint">
          by tax treatment
        </span>
      </div>

      {buckets.length > 0 && (
        <div
          className="flex h-2 rounded overflow-hidden mb-5"
          role="img"
          aria-label="Tax bucket allocation bar"
        >
          {buckets.map((b, i) => {
            const widthPct = total > 0 ? (b.valueCents.toFloat() / total) * 100 : 0;
            const color = colors[i];
            return (
              <span
                key={b.key}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="transition-opacity duration-100"
                style={{
                  width: `${widthPct.toFixed(1)}%`,
                  background: color,
                  opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.5,
                }}
                aria-hidden="true"
              />
            );
          })}
        </div>
      )}

      {/* One grid with subgrid rows so the value/percent columns align across
          rows (a per-row grid sizes each row's columns independently). */}
      <ul className="grid grid-cols-[1fr_auto] gap-x-8 m-0 list-none p-0 md:grid-cols-[1fr_auto_auto]">
        {buckets.map((b, i) => {
          const share = total > 0 ? b.valueCents.toFloat() / total : 0;
          const isActive = hoveredIndex === i;
          const isDim = hoveredIndex !== null && hoveredIndex !== i;
          return (
            <li
              key={b.key}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              className={[
                "col-span-2 md:col-span-3 grid grid-cols-subgrid items-center text-sm py-[11px] px-1 rounded-[5px] border-b border-line-soft last:border-b-0 transition-[background-color,opacity] duration-100",
                isActive ? "bg-panel-2" : "",
                isDim ? "opacity-50" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-[9px] h-[9px] rounded-[2px] flex-none"
                  style={{ background: colors[i] }}
                  aria-hidden="true"
                />
                <span className="text-cream truncate">{b.label}</span>
              </span>
              <span
                data-testid={`tax-bucket-${b.key}`}
                className="vfig font-mono text-sm text-cream-soft tabular-nums text-right"
              >
                {formatCurrencyWhole(b.valueCents)}
              </span>
              <span className="hidden md:block font-mono text-sm text-dim tabular-nums text-right">
                {formatPercent(share)}
              </span>
            </li>
          );
        })}
      </ul>

      {!reachableBeforeFiftyNineHalfCents.isZero() && (
        <div className="mt-5 border border-accent/25 bg-accent/5 rounded-lg px-4 py-3 text-sm text-cream-soft leading-[1.55]">
          <span className="text-accent font-medium">
            <span className="vfig">{formatCurrencyWhole(reachableBeforeFiftyNineHalfCents)}</span>
            {" reachable before 59½."}
          </span>{" "}
          Taxable plus cash, your bridge if you retire early. The rest waits on penalties or a Roth
          ladder.
        </div>
      )}
    </div>
  );
}
