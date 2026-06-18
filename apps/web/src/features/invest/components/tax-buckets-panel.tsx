"use client";

import { Decimal, SCALE_CENTS } from "@privance/core";
import { assignColors } from "@/features/dashboard/palette";
import { formatCurrencyWhole } from "@/lib/format";
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

  return (
    <div className="bg-panel border border-line rounded-[10px] p-6 h-full">
      <div className="flex justify-between items-baseline mb-4 gap-2.5 flex-wrap">
        <h3 className="font-serif text-[20px] font-normal tracking-[-0.005em]">Where it lives</h3>
        <span className="font-mono text-[10px] tracking-[.14em] uppercase text-faint">
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
                style={{ width: `${widthPct.toFixed(1)}%`, background: color }}
                aria-hidden="true"
              />
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-7 gap-y-[11px] max-[560px]:grid-cols-1 max-[560px]:gap-y-[9px]">
        {buckets.map((b, i) => (
          <div key={b.key} className="flex items-center gap-[9px] text-[14px]">
            <span
              className="w-[9px] h-[9px] rounded-[2px] flex-none"
              style={{ background: colors[i] }}
              aria-hidden="true"
            />
            <span className="flex-1 text-cream">{b.label}</span>
            <span
              data-testid={`tax-bucket-${b.key}`}
              className="vfig font-mono text-[12.5px] text-cream-soft tabular-nums"
            >
              {formatCurrencyWhole(b.valueCents)}
            </span>
          </div>
        ))}
      </div>

      {!reachableBeforeFiftyNineHalfCents.isZero() && (
        <div className="mt-5 border border-accent/25 bg-accent/5 rounded-lg px-4 py-3 text-[12.5px] text-cream-soft leading-[1.55]">
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
