"use client";

import { Decimal, type InvestmentAccount } from "@privance/core";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitleRow } from "@/components/ui/dialog";
import { parseCostBasisCents } from "../_helpers";
import type { HoldingFormValues, LocalGroup, LocalHolding } from "../types";
import { HoldingForm } from "./holding-form";

export type HoldingDialogMode = { kind: "add" } | { kind: "edit"; holding: LocalHolding };

type HoldingDialogProps = {
  open: boolean;
  mode: HoldingDialogMode;
  investmentAccounts: InvestmentAccount[];
  groups: LocalGroup[];
  onClose: () => void;
  onSubmit: (
    values: HoldingFormValues,
    mode: HoldingDialogMode,
    opts: { proxyPrice?: string },
  ) => Promise<void>;
  onLookupProxyPrice?: (ticker: string) => Promise<string | null>;
  onCreateGroup: (name: string) => Promise<string>;
  submitting: boolean;
};

function deriveInitialValues(mode: HoldingDialogMode): Partial<HoldingFormValues> {
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

export function HoldingDialog({
  open,
  mode,
  investmentAccounts,
  groups,
  onClose,
  onSubmit,
  onLookupProxyPrice,
  onCreateGroup,
  submitting,
}: HoldingDialogProps) {
  const [openVersion, setOpenVersion] = useState(0);

  useEffect(() => {
    if (open) setOpenVersion((v) => v + 1);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-labelledby="holding-dialog-title">
        <div className="flex flex-col gap-5">
          <DialogTitleRow
            titleId="holding-dialog-title"
            title={mode.kind === "add" ? "Add holding" : "Edit holding"}
            onClose={onClose}
          />

          <HoldingForm
            key={mode.kind === "edit" ? mode.holding.id : `new-${openVersion}`}
            initialValues={deriveInitialValues(mode)}
            investmentAccounts={investmentAccounts}
            groups={groups}
            isEdit={mode.kind === "edit"}
            submitting={submitting}
            onCancel={onClose}
            onSubmit={(values, opts) => void onSubmit(values, mode, opts)}
            onLookupProxyPrice={onLookupProxyPrice}
            onCreateGroup={onCreateGroup}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
