"use client";

import { Decimal, SCALE_CENTS } from "@privance/core";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatCurrency, formatCurrencyWhole } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import { useMediaQuery } from "@/lib/use-media-query";
import { type PlanFormValues, resolveStockPctOrNull } from "../types";
import type { AssumptionsFormProps } from "./assumptions-form";
import { AssumptionsForm, presetLabel } from "./assumptions-form";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fromDollars(dollars: number): Decimal {
  return Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS);
}

function buildContextString(manual?: Decimal, liab?: Decimal): string | null {
  const parts: string[] = [];
  if (manual !== undefined && !manual.isZero()) {
    parts.push(`${formatCurrency(manual)} manual assets`);
  }
  if (liab !== undefined && !liab.isZero()) {
    parts.push(`${formatCurrency(liab)} liabilities`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type AssumptionsBarSummary = {
  potCents: Decimal | null;
  values: PlanFormValues | null;
};

export type AssumptionsBarProps = AssumptionsFormProps & {
  summary: AssumptionsBarSummary;
  defaultExpanded: boolean;
  /** Show the "Starting portfolio" line. False once the headline anchor shows
   *  the same number, so it isn't repeated; true in the no-results placeholder. */
  showStartingPot: boolean;
  manualAssetsCents?: Decimal;
  liabilitiesCents?: Decimal;
  /** Notifies the parent when the editor opens/closes, so the levers can hide
   *  while editing (the form and levers edit the same plan; one at a time). */
  onExpandedChange?: (expanded: boolean) => void;
};

// ---------------------------------------------------------------------------
// ContextNote: the "Not simulated: ..." line, shared by both bar states.
// ---------------------------------------------------------------------------

function ContextNote({ context }: { context: string | null }) {
  if (context === null) return null;
  return (
    <p className="text-xs text-app-dim" data-testid="pot-context">
      Not simulated: {context}
    </p>
  );
}

// ---------------------------------------------------------------------------
// PotNote: starting-portfolio display (desktop expanded; collapsed shows it inline).
// ---------------------------------------------------------------------------

function PotNote({
  potCents,
  showPot,
  manualAssetsCents,
  liabilitiesCents,
}: {
  potCents: Decimal | null;
  showPot: boolean;
  manualAssetsCents?: Decimal;
  liabilitiesCents?: Decimal;
}) {
  const context = buildContextString(manualAssetsCents, liabilitiesCents);
  const hasPotLine = showPot && potCents !== null;
  if (!hasPotLine && context === null) return null;

  return (
    <div className="flex flex-col gap-0.5">
      {showPot && potCents !== null && (
        <p className="text-sm text-app-muted">
          Starting portfolio:{" "}
          <b>
            <span data-testid="starting-pot">{formatCurrencyWhole(potCents)}</span>
          </b>
        </p>
      )}
      <ContextNote context={context} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssumptionsSheet: full-screen mobile sheet, mirrors HoldingDrawer so the
// plan form matches the Add holding / Add account pattern on phones.
// ---------------------------------------------------------------------------

function AssumptionsSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Close the native dialog if the component unmounts while open, so its
  // top-layer entry is not orphaned (e.g. navigating away mid-edit on mobile).
  useEffect(() => {
    return () => {
      const dialog = dialogRef.current;
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-0 rounded-none p-0 shadow-xl w-full h-svh max-w-none max-h-none bg-app-panel border-0 backdrop:bg-black/50 focus-visible:outline-none"
      aria-modal="true"
      aria-label="Plan assumptions"
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-5 border-b border-app-line-soft shrink-0">
          <h2
            className="font-serif text-[24px] leading-tight font-light tracking-[-0.015em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            Adjust plan
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Done editing assumptions"
            className="p-1 rounded-full hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer"
          >
            <X size={20} className="text-app-muted" />
          </button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto [padding-bottom:max(env(safe-area-inset-bottom),5rem)]">
          {children}
        </div>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// CollapsedSummary: the at-a-glance assumptions, as chips with an Adjust trigger.
// ---------------------------------------------------------------------------

const SLIDERS_ICON = (
  <svg
    aria-hidden="true"
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    viewBox="0 0 24 24"
  >
    <path strokeLinecap="round" d="M3 6h18M7 12h10M11 18h2" />
  </svg>
);

/** The gold "Adjust plan" trigger, shared by the chip row and the mobile card. */
function AdjustButton({ onAdjust, className }: { onAdjust: () => void; className?: string }) {
  return (
    <button
      type="button"
      // Collapsed disclosure trigger: the editor it opens lives in a separate
      // node (the desktop panel or the mobile sheet), so no stable aria-controls
      // target exists across both. aria-expanded is always false here because the
      // expanded state swaps this button for the "Done" control.
      aria-expanded={false}
      aria-label="Adjust plan"
      onClick={onAdjust}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-full bg-gold-accent px-4 py-2 text-[13px] font-medium text-app-bg transition-colors hover:bg-gold-accent-hover cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent",
        className ?? "",
      ].join(" ")}
    >
      Adjust plan
      {SLIDERS_ICON}
    </button>
  );
}

function Chip({
  k,
  children,
  onClick,
}: {
  k: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-app-line bg-transparent px-3.5 py-2 text-[13px] text-app-text transition-colors hover:border-app-muted/45 hover:bg-white/[0.02] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent"
    >
      <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-app-dim">{k}</span>
      <span className="font-medium">{children}</span>
    </button>
  );
}

function CollapsedSummary({
  summary,
  manualAssetsCents,
  liabilitiesCents,
  onAdjust,
  isMobile,
}: {
  summary: AssumptionsBarSummary;
  manualAssetsCents?: Decimal;
  liabilitiesCents?: Decimal;
  onAdjust: () => void;
  isMobile: boolean;
}) {
  const { values, potCents } = summary;
  const context = buildContextString(manualAssetsCents, liabilitiesCents);

  if (values === null || potCents === null) {
    return (
      <section
        className="flex items-center justify-between gap-4 rounded-xl border border-app-line bg-app-panel px-4 py-3"
        aria-label="Plan assumptions"
      >
        <p className="text-sm text-app-muted">Set your assumptions to project.</p>
        <AdjustButton onAdjust={onAdjust} />
      </section>
    );
  }

  const stock = resolveStockPctOrNull(values);
  const saving = `${formatCurrencyWhole(fromDollars(values.monthlyContribution ?? 0))}/mo`;
  const spending = `${formatCurrencyWhole(fromDollars(values.annualSpend))}/yr`;
  const stockLabel = stock !== null ? `${stock}%` : presetLabel(values.preset);

  // Render exactly one layout (not CSS-toggled), so a single Adjust trigger and
  // a single starting-pot node exist regardless of whether the stylesheet loaded.
  return (
    <section aria-label="Plan assumptions" className="flex flex-col gap-2">
      {isMobile ? (
        <div className="rounded-2xl border border-app-line bg-app-panel p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <div className="flex flex-col gap-1">
              <dt className="font-mono text-[9px] tracking-[0.14em] uppercase text-app-dim">
                Start
              </dt>
              <dd className="text-base font-medium text-app-text" data-testid="starting-pot">
                {formatCurrencyWhole(potCents)}
              </dd>
            </div>
            {(
              [
                ["Saving", saving],
                ["Spending", spending],
                ["SWR", `${values.swrPercent}%`],
                ["Stocks", stockLabel],
                ["Age", `${values.currentAge} to ${values.planUntilAge}`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1">
                <dt className="font-mono text-[9px] tracking-[0.14em] uppercase text-app-dim">
                  {k}
                </dt>
                <dd className="text-base font-medium text-app-text">{v}</dd>
              </div>
            ))}
          </dl>
          <AdjustButton onAdjust={onAdjust} className="mt-4 w-full" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Chip k="Start" onClick={onAdjust}>
            <span data-testid="starting-pot">{formatCurrencyWhole(potCents)}</span>
          </Chip>
          <Chip k="Saving" onClick={onAdjust}>
            {saving}
          </Chip>
          <Chip k="Spending" onClick={onAdjust}>
            {spending}
          </Chip>
          <Chip k="SWR" onClick={onAdjust}>
            {values.swrPercent}%
          </Chip>
          <Chip k="Stocks" onClick={onAdjust}>
            {stockLabel}
          </Chip>
          <Chip k="Age" onClick={onAdjust}>
            {values.currentAge} to {values.planUntilAge}
          </Chip>
          <AdjustButton onAdjust={onAdjust} className="ml-auto" />
        </div>
      )}

      {context !== null && <ContextNote context={context} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// AssumptionsBar
// ---------------------------------------------------------------------------

export function AssumptionsBar({
  summary,
  defaultExpanded,
  showStartingPot,
  manualAssetsCents,
  liabilitiesCents,
  defaultValues,
  onChange,
  onSave,
  saving,
  saveDisabled,
  onExpandedChange,
}: AssumptionsBarProps) {
  // Phones edit in a full-screen sheet (matching Add holding / Add account);
  // wider screens keep the roomy inline expand. False until mounted, so the
  // static export never mismatches at hydration.
  const isMobile = useMediaQuery("(max-width: 767px)");
  // Hold the editor closed until hydration resolves isMobile, so the form
  // mounts straight into the correct container (inline vs sheet) instead of
  // mounting inline first and remounting into the sheet on a phone.
  const hydrated = useHydrated();
  // null = no explicit user action yet. Desktop auto-opens the inline editor
  // for first-time setup; mobile waits for a tap so a full-screen sheet never
  // ambushes the user on load. Adjust / Done / Save flip this explicitly.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const expanded = userToggled ?? (defaultExpanded && !isMobile);
  const showEditor = expanded && hydrated;

  // Tell the parent so it can hide the levers while the editor is open.
  useEffect(() => {
    onExpandedChange?.(showEditor);
  }, [showEditor, onExpandedChange]);

  // Saving collapses the editor, same as Done. On failure onSave throws, the
  // form surfaces the error, and the editor stays open.
  const handleSave = async (values: PlanFormValues) => {
    await onSave(values);
    setUserToggled(false);
  };

  const form = () => (
    <AssumptionsForm
      defaultValues={defaultValues}
      onChange={onChange}
      onSave={handleSave}
      saving={saving}
      saveDisabled={saveDisabled}
    />
  );

  const desktopExpanded = showEditor && !isMobile;
  const sheetOpen = showEditor && isMobile;

  return (
    <>
      {desktopExpanded ? (
        <div className="flex flex-col gap-3">
          <PotNote
            potCents={summary.potCents}
            showPot={showStartingPot}
            manualAssetsCents={manualAssetsCents}
            liabilitiesCents={liabilitiesCents}
          />
          <div
            id="assumptions-panel"
            className="rounded-2xl border border-app-line bg-app-panel p-6"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2
                className="font-serif text-[22px] font-light leading-tight tracking-[-0.01em] text-app-text"
                style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
              >
                Adjust your plan
              </h2>
              <button
                type="button"
                aria-expanded={true}
                aria-controls="assumptions-panel"
                aria-label="Done editing assumptions"
                onClick={() => setUserToggled(false)}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-app-line text-app-muted transition-colors hover:border-app-muted/45 hover:text-app-text cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent"
              >
                <X size={13} />
              </button>
            </div>
            {form()}
          </div>
        </div>
      ) : (
        <div>
          <h2 className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim mb-4">
            Assumptions
          </h2>
          <CollapsedSummary
            summary={summary}
            manualAssetsCents={manualAssetsCents}
            liabilitiesCents={liabilitiesCents}
            onAdjust={() => setUserToggled(true)}
            isMobile={isMobile}
          />
        </div>
      )}

      <AssumptionsSheet open={sheetOpen} onClose={() => setUserToggled(false)}>
        {sheetOpen ? form() : null}
      </AssumptionsSheet>
    </>
  );
}
