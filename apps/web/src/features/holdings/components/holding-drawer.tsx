"use client";

import { Decimal, type InvestmentAccount } from "@privance/core";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
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
  // The form takes avg cost per share; stored value is the total, so divide back.
  // The division stays in Decimal (never float math on money); div() yields the
  // wider operand's scale, so format to 2dp at the display boundary to match the
  // field's cents precision.
  let avgCostPerShare = "";
  try {
    const cost = parseCostBasisCents(holding.costBasisCents);
    const shares = Decimal.fromString(holding.sharesMajor, holding.sharesScale);
    if (!shares.isZero()) {
      avgCostPerShare = cost.div(shares).toFloat().toFixed(2);
    }
  } catch {}
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
  const [openVersion, setOpenVersion] = useState(0);

  useEffect(() => {
    if (open) setOpenVersion((v) => v + 1);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="holding-drawer-title"
      className="max-h-[88vh] overflow-y-auto"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2
            id="holding-drawer-title"
            className="font-serif text-2xl leading-tight font-light tracking-[-0.01em] text-cream"
          >
            {mode.kind === "add" ? "Add holding" : "Edit holding"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 cursor-pointer text-faint hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={18} />
          </button>
        </div>

        <HoldingForm
          key={mode.kind === "edit" ? mode.holding.id : `new-${openVersion}`}
          initialValues={deriveInitialValues(mode)}
          investmentAccounts={investmentAccounts}
          groups={groups}
          isEdit={mode.kind === "edit"}
          submitting={submitting}
          onSubmit={(values, opts) => void onSubmit(values, mode, opts)}
          onLookupProxyPrice={onLookupProxyPrice}
          onCreateGroup={onCreateGroup}
        />
      </div>
    </Modal>
  );
}
