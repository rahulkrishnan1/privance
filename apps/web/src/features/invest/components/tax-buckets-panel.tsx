import { Decimal, SCALE_CENTS } from "@privance/core";
import { memo, useState } from "react";
import { ExpandableAllocationRow } from "@/components/ui/expandable-allocation-row";
import { assignColors } from "@/features/dashboard/palette";
import { formatCurrencyWhole, formatPercent } from "@/lib/format";
import type { TaxBucket } from "../_invest-math";
import type { TaxBucketAccount } from "../types";

type TaxBucketsPanelProps = {
  buckets: TaxBucket[];
  reachableBeforeFiftyNineHalfCents: Decimal;
};

const AccountContributions = memo(function AccountContributions({
  accounts,
}: {
  accounts: TaxBucketAccount[];
}) {
  return (
    <div className="ml-[21px] border-l border-line-soft pb-2 pl-4">
      {accounts.map((account) => (
        <div
          key={account.accountId}
          className="grid min-h-[42px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line-soft py-2 pr-7 last:border-b-0 max-[520px]:pr-3"
        >
          <div className="min-w-0">
            <p className="break-words text-sm text-cream">{account.name}</p>
            {account.detail && (
              <p className="font-mono text-xs tracking-[.03em] text-faint">{account.detail}</p>
            )}
          </div>
          <span className="vfig shrink-0 text-right font-mono text-xs tabular-nums text-cream">
            {formatCurrencyWhole(account.valueCents)}
          </span>
        </div>
      ))}
    </div>
  );
});

export function TaxBucketsPanel({
  buckets,
  reachableBeforeFiftyNineHalfCents,
}: TaxBucketsPanelProps) {
  // Sum in Decimal so the denominator does not drift from float summation; the
  // per-slice width is a display ratio so the final toFloat is at the UI boundary.
  const totalCents = buckets.reduce((sum, b) => sum.add(b.valueCents), Decimal.zero(SCALE_CENTS));
  const total = totalCents.toFloat();
  const colors = assignColors(buckets.map((b) => b.label));
  const shares = buckets.map((bucket) => (total > 0 ? bucket.valueCents.toFloat() / total : 0));
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [openBucket, setOpenBucket] = useState<TaxBucket["key"] | null>(null);

  return (
    <div className="glass rounded-[10px] p-6 h-full">
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
            const color = colors[i];
            return (
              <span
                key={b.key}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="transition-opacity duration-100"
                style={{
                  width: `${(shares[i] * 100).toFixed(1)}%`,
                  background: color,
                  opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.5,
                }}
                aria-hidden="true"
              />
            );
          })}
        </div>
      )}

      <ul className="-mx-1 my-0 grid list-none grid-cols-[minmax(0,1fr)_auto_7ch_18px] gap-x-8 p-0 max-[520px]:gap-x-3 max-[360px]:grid-cols-[minmax(0,1fr)_auto_18px] max-[360px]:gap-x-2">
        {buckets.map((b, i) => {
          const share = shares[i];
          const isActive = hoveredIndex === i;
          const isDim = hoveredIndex !== null && hoveredIndex !== i;
          const isOpen = openBucket === b.key;
          const detailsId = `tax-bucket-details-${b.key}`;
          return (
            <ExpandableAllocationRow
              key={b.key}
              detailsId={detailsId}
              isOpen={isOpen}
              color={colors[i]}
              label={<span className="break-words text-cream">{b.label}</span>}
              amount={formatCurrencyWhole(b.valueCents)}
              share={formatPercent(share)}
              details={<AccountContributions accounts={b.accounts} />}
              amountTestId={`tax-bucket-${b.key}`}
              isHighlighted={isActive}
              isDimmed={isDim}
              onToggle={() => setOpenBucket(isOpen ? null : b.key)}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
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
