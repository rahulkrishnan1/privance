"use client";

import type { InvestmentAccount } from "@privance/core";
import { Decimal } from "@privance/core";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parseCostBasisCents } from "../_helpers";
import type { HoldingFormValues, LocalGroup, LocalHolding } from "../types";
import { HoldingForm } from "./holding-form";

export type DrawerMode = { kind: "add" } | { kind: "edit"; holding: LocalHolding };

type HoldingDrawerProps = {
  open: boolean;
  mode: DrawerMode;
  investmentAccounts: InvestmentAccount[];
  groups: LocalGroup[];
  onClose: () => void;
  onSubmit: (
    values: HoldingFormValues,
    mode: DrawerMode,
    opts: { proxyPrice?: string },
  ) => Promise<void>;
  onLookupProxyPrice?: (ticker: string) => Promise<string | null>;
  onCreateGroup: (name: string) => Promise<string>;
  submitting: boolean;
};

function deriveInitialValues(mode: DrawerMode): Partial<HoldingFormValues> {
  if (mode.kind === "add") return {};
  const { holding } = mode;
  let avgCostPerShare = "0";
  try {
    const cost = parseCostBasisCents(holding.costBasisCents);
    const shares = Decimal.fromString(holding.sharesMajor, holding.sharesScale);
    if (!shares.isZero()) {
      // Decimal.div returns max(scale_cost, scale_shares) = 8, which renders as
      // "150.00000000". The form caps avg cost at 2 dp, so pre-fill at 2 dp.
      avgCostPerShare = cost.div(shares).toFloat().toFixed(2);
    }
  } catch {
    // fall through with "0"
  }
  return {
    assetType: holding.assetType,
    ticker: holding.ticker,
    accountId: holding.accountId,
    shares: holding.sharesMajor,
    avgCostPerShare,
    proxyTicker: holding.proxyTicker ?? "",
    groupId: holding.groupId ?? "",
  };
}

/**
 * Add / edit holding dialog. Uses the native <dialog> element so Escape, focus
 * trap, and inert-page semantics come for free. Layout classes (flex/grid) must
 * live on the inner wrapper, NOT on <dialog> itself, Tailwind's `display:flex`
 * silently overrides the UA `dialog:not([open]) { display: none }` rule, which
 * leaks the dialog into the page on every render.
 */
export function HoldingDrawer({
  open,
  mode,
  investmentAccounts,
  groups,
  onClose,
  onSubmit,
  onLookupProxyPrice,
  onCreateGroup,
  submitting,
}: HoldingDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [openVersion, setOpenVersion] = useState(0);

  useEffect(() => {
    if (open) setOpenVersion((v) => v + 1);
  }, [open]);

  // Idempotent, calling showModal() on an already-open dialog throws.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-0 sm:m-auto rounded-none sm:rounded-2xl p-0 shadow-xl w-full h-svh sm:h-auto max-w-none sm:max-w-md max-h-none sm:max-h-[90vh] bg-app-panel border-0 backdrop:bg-black/50 focus-visible:outline-none"
      aria-modal="true"
      aria-label={mode.kind === "add" ? "Add holding" : "Edit holding"}
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-5 border-b border-app-line-soft shrink-0">
          <h2
            className="font-serif text-[26px] leading-tight font-light tracking-[-0.015em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            {mode.kind === "add" ? "Add holding" : "Edit holding"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-full hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer"
          >
            <X size={20} className="text-app-muted" />
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto [padding-bottom:max(env(safe-area-inset-bottom),5rem)] sm:[padding-bottom:1.25rem]">
          <HoldingForm
            key={mode.kind === "edit" ? mode.holding.id : `new-${openVersion}`}
            initialValues={deriveInitialValues(mode)}
            investmentAccounts={investmentAccounts}
            groups={groups}
            submitting={submitting}
            onSubmit={(values, opts) => void onSubmit(values, mode, opts)}
            onLookupProxyPrice={onLookupProxyPrice}
            onCreateGroup={onCreateGroup}
          />
        </div>
      </div>
    </dialog>
  );
}
