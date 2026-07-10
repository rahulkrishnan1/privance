"use client";

import type { BillingUnit } from "@privance/core";
import { useMemo, useState } from "react";
import { Button, CadenceSuffix } from "@/components";
import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import { useSync } from "@/providers";
import { CATEGORY_LABELS } from "../_constants";
import { useSpendMutations } from "../mutations";
import { useSpendItemsQuery } from "../queries";
import type { LocalSpendItem, SpendFormValues } from "../types";
import {
  billedAmountCents,
  dailyEquivalentCents,
  monthlyEquivalentCents,
  nextBillDate,
  subscriptionSharePct,
  totalAnnualCents,
  totalMonthlyCents,
  weeklyEquivalentCents,
} from "./_spend-math";
import { CategoryIcon } from "./category-icon";
import { SpendForm } from "./spend-form";

const MAX_WIDTH = "max-w-[1120px] mx-auto px-7 max-[760px]:px-4";

// Order a panel's rows by monthly-equivalent value, highest first, matching how
// holdings and accounts sort by value.
function byMonthlyDesc(a: LocalSpendItem, b: LocalSpendItem): number {
  return monthlyEquivalentCents(b.amountCents, b.intervalCount, b.intervalUnit).cmp(
    monthlyEquivalentCents(a.amountCents, a.intervalCount, a.intervalUnit),
  );
}

// The next bill date, always with the year so any cadence reads unambiguously.
function formatBillDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Category is shown by the icon and the amount is rendered separately (vfig), so
// this line carries only the bill-date verb.
function subLine(item: LocalSpendItem, now: Date): string {
  if (item.status === "paused") return "resumes when you do";
  if (!item.nextRenewalAt) return "";
  const verb = item.group === "essentials" ? "due" : "renews";
  const next = nextBillDate(item.nextRenewalAt, item.intervalCount, item.intervalUnit, now);
  return `${verb} ${formatBillDate(next)}`;
}

// Money figure shows cents only when the value is not a whole dollar, so
// "$1,450" and "$15.49" read as in the mock. Branches on Decimal minor units to
// avoid any float comparison.
function formatMoney(d: ReturnType<typeof monthlyEquivalentCents>): string {
  return d.toMinorUnits() % 100n === 0n ? formatCurrencyWhole(d) : formatCurrency(d);
}

const UNIT_ABBR: Record<BillingUnit, string> = { day: "day", week: "wk", month: "mo", year: "yr" };

function cadenceUnit(item: LocalSpendItem): string {
  const unit = UNIT_ABBR[item.intervalUnit];
  return item.intervalCount === 1 ? unit : `${item.intervalCount}${unit}`;
}

function RecurringRow({
  item,
  now,
  onClick,
}: {
  item: LocalSpendItem;
  now: Date;
  onClick: () => void;
}) {
  const isPaused = item.status === "paused";
  const monthly = monthlyEquivalentCents(item.amountCents, item.intervalCount, item.intervalUnit);
  const billed = billedAmountCents(item.amountCents, item.intervalCount, item.intervalUnit);
  const sub = subLine(item, now);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-3.5 w-full py-3 border-b border-line-soft text-left cursor-pointer hover:bg-white/1 transition-colors",
        "last:border-b-0",
        isPaused ? "opacity-45" : "",
      ]
        .join(" ")
        .trim()}
    >
      <span className="w-[34px] h-[34px] rounded-[8px] bg-panel-2 border border-line flex items-center justify-center text-accent flex-none">
        <CategoryIcon category={item.category} className="w-4 h-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-cream">
          {item.name}
          {/* Category is icon-only visually; keep it in the accessible name for screen readers. */}
          <span className="sr-only"> {CATEGORY_LABELS[item.category]}</span>
          {isPaused && (
            <span className="inline-block font-mono text-xs tracking-label uppercase text-faint border border-line rounded-full px-[7px] py-[2px] ml-[7px] align-[1px]">
              paused
            </span>
          )}
        </span>
        {(sub || (!isPaused && billed !== null)) && (
          <span className="block font-mono text-xs text-faint mt-[3px]">
            {sub}
            {!isPaused && billed !== null && (
              <>
                {sub && " ("}
                <span className="vfig">{formatMoney(billed)}</span>
                <CadenceSuffix unit={cadenceUnit(item)} />
                {sub && ")"}
              </>
            )}
          </span>
        )}
      </span>
      <span
        className={[
          "font-mono text-sm tabular-nums text-right flex-none",
          isPaused ? "line-through" : "",
        ]
          .join(" ")
          .trim()}
      >
        <span className="vfig">{formatMoney(monthly)}</span>
        <CadenceSuffix unit="mo" className="text-xs text-faint" />
      </span>
    </button>
  );
}

// Shared panel footer: active/paused count on the left, monthly and annual
// totals on the right. Identical on both panels so they read uniformly.
function SubtotalRow({ items }: { items: LocalSpendItem[] }) {
  const active = items.filter((i) => i.status === "active");
  const paused = items.filter((i) => i.status === "paused");
  const monthly = totalMonthlyCents(items);
  const annual = totalAnnualCents(items);

  const countText =
    paused.length > 0
      ? `${active.length} active, ${paused.length} paused`
      : `${active.length} active`;

  return (
    <div className="flex justify-between flex-wrap gap-1 border-t border-line-soft mt-2.5 pt-3.5 font-mono text-xs tracking-[.06em] text-faint">
      <span>{countText}</span>
      <span>
        <b className="vfig text-cream font-medium tabular-nums">{formatCurrencyWhole(monthly)}</b>
        <CadenceSuffix unit="mo" />
        {", "}
        <b className="vfig text-cream font-medium tabular-nums">{formatCurrencyWhole(annual)}</b>
        <CadenceSuffix unit="yr" />
      </span>
    </div>
  );
}

function Panel({
  title,
  items,
  now,
  onRowClick,
  className,
}: {
  title: string;
  items: LocalSpendItem[];
  now: Date;
  onRowClick: (item: LocalSpendItem) => void;
  className: string;
}) {
  return (
    <div className={`glass rounded-[10px] p-6 ${className}`}>
      <h3 className="font-serif text-2xl font-normal tracking-[-0.005em] mb-4">{title}</h3>
      {/* Rows wrapped so the last row is a real :last-child and drops its border,
          leaving the subtotal's top border as the only divider above it. */}
      <div>
        {items.map((item) => (
          <RecurringRow key={item.id} item={item} now={now} onClick={() => onRowClick(item)} />
        ))}
      </div>
      <SubtotalRow items={items} />
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3.5 py-3 border-b border-line-soft last:border-b-0">
      <div className="w-[34px] h-[34px] rounded-[8px] bg-white/5 animate-pulse flex-none" />
      <div className="flex-1">
        <div className="h-3 w-32 rounded bg-white/5 animate-pulse mb-2" />
        <div className="h-2.5 w-20 rounded bg-white/5 animate-pulse" />
      </div>
      <div className="h-3 w-14 rounded bg-white/5 animate-pulse" />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className={`${MAX_WIDTH} pt-6`}>
      <div className="h-2.5 w-16 rounded bg-white/5 animate-pulse mb-4" />
      <div className="h-16 w-52 rounded bg-white/5 animate-pulse mb-2" />
      <div className="h-3 w-48 rounded bg-white/5 animate-pulse mb-8" />
      <div className="grid grid-cols-12 gap-4 mt-4">
        <div className="col-span-7 max-[880px]:col-span-12 glass rounded-[10px] p-6">
          {[...Array(4)].map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows
            <SkeletonRow key={i} />
          ))}
        </div>
        <div className="col-span-5 max-[880px]:col-span-12 glass rounded-[10px] p-6">
          {[...Array(3)].map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SpendScreen() {
  const { items, loading, error } = useSpendItemsQuery();
  const { tick } = useSync();
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<LocalSpendItem | undefined>(undefined);

  const { creating, updating, deleting, createItem, updateItem, deleteItem } = useSpendMutations();

  const essentialItems = useMemo(
    () => items.filter((i) => i.group === "essentials").sort(byMonthlyDesc),
    [items],
  );
  const subscriptionItems = useMemo(
    () => items.filter((i) => i.group === "subscriptions").sort(byMonthlyDesc),
    [items],
  );

  const monthlyTotal = useMemo(() => totalMonthlyCents(items), [items]);
  const annualTotal = useMemo(() => totalAnnualCents(items), [items]);
  const essentialMonthly = useMemo(() => totalMonthlyCents(essentialItems), [essentialItems]);
  const essentialAnnual = useMemo(() => totalAnnualCents(essentialItems), [essentialItems]);
  const subscriptionMonthly = useMemo(
    () => totalMonthlyCents(subscriptionItems),
    [subscriptionItems],
  );
  const subscriptionAnnual = useMemo(
    () => totalAnnualCents(subscriptionItems),
    [subscriptionItems],
  );
  const activeCount = useMemo(() => items.filter((i) => i.status === "active").length, [items]);
  const subscriptionShare = useMemo(
    () => subscriptionSharePct(subscriptionMonthly, monthlyTotal),
    [subscriptionMonthly, monthlyTotal],
  );
  const dailyBurn = useMemo(() => dailyEquivalentCents(monthlyTotal), [monthlyTotal]);
  const weeklyBurn = useMemo(() => weeklyEquivalentCents(monthlyTotal), [monthlyTotal]);

  // One clock value per render so every row's next-bill date resolves against
  // the same "today", even across a midnight boundary.
  const now = new Date();

  function openAdd() {
    setEditItem(undefined);
    setFormOpen(true);
  }

  function openEdit(item: LocalSpendItem) {
    setEditItem(item);
    setFormOpen(true);
  }

  function handleClose() {
    setFormOpen(false);
    setEditItem(undefined);
  }

  async function handleSave(values: SpendFormValues) {
    if (editItem !== undefined) {
      await updateItem(editItem.id, values);
    } else {
      await createItem(values);
    }
    handleClose();
  }

  async function handleDelete() {
    if (editItem === undefined) return;
    await deleteItem(editItem.id);
    handleClose();
  }

  if (loading) return <LoadingSkeleton />;

  if (error !== null) {
    return (
      <div className={`${MAX_WIDTH} pt-6`}>
        <p className="font-mono text-xs text-down" role="alert">
          Failed to load. {error.message}
        </p>
        <button
          type="button"
          onClick={tick}
          className="mt-3 font-mono text-xs tracking-button uppercase text-accent border border-accent/30 rounded-md px-4 py-2 cursor-pointer hover:bg-accent/8 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`${MAX_WIDTH} pt-20 text-center`}>
        <div className="w-[84px] h-[84px] rounded-full border border-dashed border-white/22 flex items-center justify-center text-accent mx-auto mb-7">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-[30px] h-[30px]"
          >
            <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0M12 7v5l3 2" />
          </svg>
        </div>
        <h2 className="font-serif text-4xl tracking-[-0.01em]">
          Nothing recurring, <em className="text-accent">yet.</em>
        </h2>
        <p className="text-dim max-w-[44ch] mx-auto mt-3 text-base">
          Add the costs that hit every month, rent, utilities, insurance, subscriptions, and
          Privance keeps the running total. No bank linking, encrypted on this device.
        </p>
        <Button type="button" variant="primary" onClick={openAdd} className="mt-7">
          Add a recurring expense
        </Button>
        <SpendForm
          open={formOpen}
          onClose={handleClose}
          item={editItem}
          submitting={creating}
          onSave={handleSave}
        />
      </div>
    );
  }

  return (
    <div className={MAX_WIDTH}>
      <section className="pt-6 pb-0">
        <p className="font-mono text-xs tracking-label uppercase text-faint">Spend</p>
        <div className="flex items-end gap-5 flex-wrap mt-3">
          <span
            data-testid="spend-monthly-total"
            className="font-serif text-[clamp(48px,7vw,76px)] leading-[.95] tracking-[-0.015em]"
          >
            <span className="vfig">{formatCurrencyWhole(monthlyTotal)}</span>
            <CadenceSuffix unit="month" className="text-[.34em] text-dim tracking-[0]" />
          </span>
          <Button type="button" variant="primary" onClick={openAdd} className="mb-2.5">
            + Add expense
          </Button>
        </div>
        <p className="font-mono text-sm text-dim mt-3.5 tracking-[.02em]">
          <b className="vfig text-cream-soft font-medium">{formatCurrencyWhole(annualTotal)}</b>
          {`/year, ${activeCount} active ${activeCount === 1 ? "commitment" : "commitments"}`}
        </p>
      </section>

      <div className="grid grid-cols-4 gap-4 mt-4 max-[880px]:grid-cols-2">
        <div className="glass rounded-[10px] px-5 py-5 max-[480px]:px-4 max-[480px]:py-4">
          <p className="font-mono text-xs tracking-label uppercase text-faint">Essentials</p>
          <p className="font-serif text-3xl mt-2 max-[480px]:text-2xl">
            <span className="vfig">{formatCurrencyWhole(essentialMonthly)}</span>
            <CadenceSuffix unit="month" className="font-mono text-xs text-faint" />
          </p>
          <p className="font-mono text-xs mt-1 text-dim">
            <span className="vfig">{formatCurrencyWhole(essentialAnnual)}</span>
            <CadenceSuffix unit="year" className="text-faint" />
          </p>
        </div>
        <div className="glass rounded-[10px] px-5 py-5 max-[480px]:px-4 max-[480px]:py-4">
          <p className="font-mono text-xs tracking-label uppercase text-faint">Subscriptions</p>
          <p className="font-serif text-3xl mt-2 max-[480px]:text-2xl">
            <span className="vfig">{formatCurrencyWhole(subscriptionMonthly)}</span>
            <CadenceSuffix unit="month" className="font-mono text-xs text-faint" />
          </p>
          <p className="font-mono text-xs mt-1 text-dim">
            <span className="vfig">{formatCurrencyWhole(subscriptionAnnual)}</span>
            <CadenceSuffix unit="year" className="text-faint" />
          </p>
        </div>
        <div className="glass rounded-[10px] px-5 py-5 max-[480px]:px-4 max-[480px]:py-4">
          <p className="font-mono text-xs tracking-label uppercase text-faint">Subs share</p>
          {/* A ratio, not a money figure, so it stays readable under the Veil. */}
          <p className="font-serif text-3xl mt-2 max-[480px]:text-2xl">{subscriptionShare}%</p>
          <p className="font-mono text-xs mt-1 text-dim">of monthly spend</p>
        </div>
        <div className="glass rounded-[10px] px-5 py-5 max-[480px]:px-4 max-[480px]:py-4">
          <p className="font-mono text-xs tracking-label uppercase text-faint">Per day</p>
          <p className="font-serif text-3xl mt-2 max-[480px]:text-2xl">
            <span className="vfig">{formatCurrencyWhole(dailyBurn)}</span>
            <CadenceSuffix unit="day" className="font-mono text-xs text-faint" />
          </p>
          <p className="font-mono text-xs mt-1 text-dim">
            <span className="vfig">{formatCurrencyWhole(weeklyBurn)}</span>
            <CadenceSuffix unit="week" className="text-faint" />
          </p>
        </div>
      </div>

      {/* Two-panel grid: each panel goes full-width when the other is empty */}
      <div className="grid grid-cols-12 gap-4 mt-4">
        {essentialItems.length > 0 && (
          <Panel
            title="Essentials"
            items={essentialItems}
            now={now}
            onRowClick={openEdit}
            className={`max-[880px]:col-span-12 ${
              subscriptionItems.length > 0 ? "col-span-6" : "col-span-12"
            }`}
          />
        )}
        {subscriptionItems.length > 0 && (
          <Panel
            title="Subscriptions"
            items={subscriptionItems}
            now={now}
            onRowClick={openEdit}
            className={`max-[880px]:col-span-12 ${
              essentialItems.length > 0 ? "col-span-6" : "col-span-12"
            }`}
          />
        )}
      </div>

      <SpendForm
        open={formOpen}
        onClose={handleClose}
        item={editItem}
        submitting={editItem !== undefined ? updating : creating}
        onSave={handleSave}
        onDelete={editItem !== undefined ? handleDelete : undefined}
        deleting={deleting}
      />
    </div>
  );
}
