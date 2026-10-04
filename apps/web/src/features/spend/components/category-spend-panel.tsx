import { Decimal, SCALE_CENTS, type SpendCategory } from "@privance/core";
import { useMemo, useState } from "react";
import { CadenceSuffix } from "@/components";
import { ExpandableAllocationRow } from "@/components/ui/expandable-allocation-row";
import { assignColors } from "@/features/dashboard/palette";
import { formatPercent } from "@/lib/format";
import { CATEGORY_LABELS } from "../_constants";
import type { LocalSpendItem } from "../types";
import { formatSpendAmount, spendScheduleLine } from "./_spend-format";
import { monthlyEquivalentCents } from "./_spend-math";

const CADENCE_ABBREVIATIONS = {
  day: "day",
  week: "wk",
  month: "mo",
  year: "yr",
} as const;

const SHARE_PRECISION = 1_000_000n;

function categoryShare(value: Decimal, total: Decimal): number {
  const scaledRatio = (value.toMinorUnits() * SHARE_PRECISION) / total.toMinorUnits();
  return Number(scaledRatio) / Number(SHARE_PRECISION);
}

function formatBilledSpend(item: LocalSpendItem): { amount: string; cadence: string } {
  const value = Decimal.fromMinorUnits(BigInt(item.amountCents), SCALE_CENTS);
  const cadence = CADENCE_ABBREVIATIONS[item.intervalUnit];
  const count = item.intervalCount === 1 ? "" : String(item.intervalCount);
  return { amount: formatSpendAmount(value), cadence: `${count}${cadence}` };
}

function CategoryDetailItems({ items, now }: { items: LocalSpendItem[]; now: Date }) {
  return (
    <div className="ml-[21px] border-l border-line-soft pl-4 pb-2">
      {items.map((item) => {
        const spend = formatBilledSpend(item);
        return (
          <div
            key={item.id}
            className="flex min-h-[42px] items-center justify-between gap-4 border-b border-line-soft py-2 pr-7 last:border-b-0 max-[520px]:pr-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-cream">{item.name}</p>
              <p className="font-mono text-xs tracking-[.03em] text-faint">
                {spendScheduleLine(item, now) || "No date set"}
              </p>
            </div>
            <span className="vfig text-right font-mono text-xs tabular-nums text-cream">
              {spend.amount}
              <CadenceSuffix unit={spend.cadence} className="text-dim" />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CategorySpendPanel({ items, now }: { items: LocalSpendItem[]; now: Date }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [openCategory, setOpenCategory] = useState<SpendCategory | null>(null);

  const categories = useMemo(() => {
    const grouped = new Map<SpendCategory, LocalSpendItem[]>();
    for (const item of items) {
      if (item.status !== "active") continue;
      const group = grouped.get(item.category);
      if (group) group.push(item);
      else grouped.set(item.category, [item]);
    }

    return [...grouped.entries()]
      .map(([category, categoryItems]) => {
        const monthlyItems = categoryItems
          .map((item) => ({
            item,
            monthly: monthlyEquivalentCents(
              item.amountCents,
              item.intervalCount,
              item.intervalUnit,
            ),
          }))
          .sort((a, b) => b.monthly.cmp(a.monthly));

        return {
          category,
          items: monthlyItems.map(({ item }) => item),
          monthly: monthlyItems.reduce(
            (sum, entry) => sum.add(entry.monthly),
            Decimal.zero(SCALE_CENTS),
          ),
        };
      })
      .sort((a, b) => b.monthly.cmp(a.monthly));
  }, [items]);

  const total = useMemo(
    () =>
      categories.reduce((sum, category) => sum.add(category.monthly), Decimal.zero(SCALE_CENTS)),
    [categories],
  );
  const shares = useMemo(
    () =>
      total.isZero() ? [] : categories.map((category) => categoryShare(category.monthly, total)),
    [categories, total],
  );

  if (categories.length === 0 || total.isZero()) return null;

  const colors = assignColors(categories.map(({ category }) => CATEGORY_LABELS[category]));
  const openIndex = categories.findIndex(({ category }) => category === openCategory);
  const activeIndex = hoveredIndex ?? focusedIndex ?? (openIndex < 0 ? null : openIndex);

  return (
    <section className="glass mt-4 rounded-[10px] p-6" aria-labelledby="category-spend-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2.5">
        <h3
          id="category-spend-title"
          className="font-serif text-2xl font-normal tracking-[-0.005em]"
        >
          By category
        </h3>
        <span className="font-mono text-xs uppercase tracking-label text-faint">
          {categories.length} {categories.length === 1 ? "category" : "categories"}
        </span>
      </div>

      <div
        className="mb-5 flex h-2 overflow-hidden rounded"
        role="img"
        aria-label="Category spend allocation bar"
      >
        {categories.map((category, index) => {
          const widthPct = shares[index] * 100;
          return (
            <span
              key={category.category}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              className="transition-opacity duration-100 motion-reduce:transition-none"
              style={{
                width: `${widthPct.toFixed(2)}%`,
                background: colors[index],
                opacity: activeIndex === null || activeIndex === index ? 1 : 0.5,
              }}
              aria-hidden="true"
            />
          );
        })}
      </div>

      <ul className="-mx-1 m-0 grid list-none grid-cols-[minmax(0,1fr)_auto_7ch_18px] gap-x-8 p-0 max-[520px]:gap-x-3 max-[360px]:grid-cols-[minmax(0,1fr)_auto_18px] max-[360px]:gap-x-2">
        {categories.map((category, index) => {
          const share = shares[index];
          const isOpen = openCategory === category.category;
          const detailsId = `category-details-${category.category}`;

          return (
            <ExpandableAllocationRow
              key={category.category}
              detailsId={detailsId}
              isOpen={isOpen}
              color={colors[index]}
              label={
                <span className="truncate text-cream">{CATEGORY_LABELS[category.category]}</span>
              }
              amount={
                <>
                  {formatSpendAmount(category.monthly)}
                  <span className="text-dim">/mo</span>
                </>
              }
              share={formatPercent(share)}
              details={<CategoryDetailItems items={category.items} now={now} />}
              isHighlighted={activeIndex === index}
              isDimmed={activeIndex !== null && activeIndex !== index}
              onToggle={() => {
                if (isOpen) setFocusedIndex(null);
                setOpenCategory(isOpen ? null : category.category);
              }}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex(null)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          );
        })}
      </ul>
    </section>
  );
}
