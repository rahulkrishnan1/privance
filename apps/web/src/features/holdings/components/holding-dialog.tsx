import { Decimal, type InvestmentAccount } from "@privance/core";
import { useEffect, useState } from "react";
import { Button } from "@/components/index";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetTitleRow } from "@/components/ui/sheet";
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
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (open) setOpenVersion((v) => v + 1);
  }, [open]);

  const lookupProxyPrice =
    onLookupProxyPrice === undefined
      ? undefined
      : async (ticker: string) => {
          setLookingUp(true);
          try {
            return await onLookupProxyPrice(ticker);
          } finally {
            setLookingUp(false);
          }
        };
  const busy = submitting || lookingUp;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent aria-labelledby="holding-dialog-title" scrollable={false}>
        <div className="mb-5 shrink-0">
          <SheetTitleRow
            titleId="holding-dialog-title"
            title={mode.kind === "add" ? "Add holding" : "Edit holding"}
            onClose={onClose}
          />
        </div>
        <SheetBody>
          <HoldingForm
            key={mode.kind === "edit" ? mode.holding.id : `new-${openVersion}`}
            initialValues={deriveInitialValues(mode)}
            investmentAccounts={investmentAccounts}
            groups={groups}
            isEdit={mode.kind === "edit"}
            onSubmit={async (values, opts) => {
              setLookingUp(true);
              try {
                await onSubmit(values, mode, opts);
              } finally {
                setLookingUp(false);
              }
            }}
            onLookupProxyPrice={lookupProxyPrice}
            onCreateGroup={onCreateGroup}
          />
        </SheetBody>
        <SheetFooter className="static mt-4 shrink-0">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="holding-form"
            variant="primary"
            disabled={busy}
            loading={busy}
          >
            {busy ? "Saving..." : mode.kind === "edit" ? "Save changes" : "Add holding"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
