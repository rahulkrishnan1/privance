import { Decimal, SCALE_CENTS } from "@privance/core";
import { useState } from "react";
import { Button, CadenceSuffix, CloseButton, ConfirmDeleteButton } from "@/components";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetTitle,
  useSheetCloseAction,
} from "@/components/ui/sheet";
import { useKeepLastNonNull } from "@/lib/use-keep-last";
import { BILLING_UNIT_LABELS, CATEGORY_LABELS, GROUP_LABELS } from "../_constants";
import type { LocalSpendItem } from "../types";
import { formatSpendAmount, formatSpendDate } from "./_spend-format";
import { nextBillDate } from "./_spend-math";

type SpendDetailSheetProps = {
  open: boolean;
  item: LocalSpendItem | null;
  onClose: () => void;
  onEdit: (item: LocalSpendItem) => void;
  onDelete: (item: LocalSpendItem) => Promise<void>;
};

function cadenceUnit(item: LocalSpendItem): string {
  const unit = BILLING_UNIT_LABELS[item.intervalUnit].toLowerCase();
  return item.intervalCount === 1 ? unit : `${item.intervalCount} ${unit}s`;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-line-soft py-2.5 text-sm last:border-b-0">
      <span className="text-dim">{label}</span>
      <span className="text-right font-mono text-sm tabular-nums text-cream-soft">{children}</span>
    </div>
  );
}

function SpendDetailBody({
  item,
  onClose,
  onEdit,
  onDelete,
}: Omit<SpendDetailSheetProps, "open" | "item"> & { item: LocalSpendItem }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const amount = Decimal.fromMinorUnits(BigInt(item.amountCents), SCALE_CENTS);
  const cadence = cadenceUnit(item);
  const nextBill = item.nextRenewalAt
    ? nextBillDate(item.nextRenewalAt, item.intervalCount, item.intervalUnit, new Date())
    : null;

  async function handleDelete() {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await onDelete(item);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs uppercase tracking-label text-accent">
            {GROUP_LABELS[item.group]}
          </p>
          <SheetTitle
            render={
              // biome-ignore lint/a11y/useHeadingContent: heading text is injected as children by Base UI's render prop
              <h3 className="mt-1.5 truncate font-serif text-3xl font-light tracking-[-0.01em]" />
            }
          >
            {item.name}
          </SheetTitle>
        </div>
        <CloseButton onClick={onClose} label="Close expense details" />
      </div>

      <p data-testid="spend-detail-amount" className="mt-5 font-serif text-5xl tracking-[-0.01em]">
        <span className="vfig">{formatSpendAmount(amount)}</span>
        <CadenceSuffix unit={cadence} className="font-mono text-sm text-dim" />
      </p>

      <p className="mb-1 mt-7 font-mono text-xs uppercase tracking-label text-faint">Details</p>
      <div>
        <DetailRow label="Cadence">Every {cadence}</DetailRow>
        <DetailRow label="Next bill">
          {item.status === "paused"
            ? "Not scheduled"
            : nextBill
              ? formatSpendDate(nextBill)
              : "Not set"}
        </DetailRow>
        <DetailRow label="Category">{CATEGORY_LABELS[item.category]}</DetailRow>
        <DetailRow label="Status">{item.status === "active" ? "Active" : "Paused"}</DetailRow>
      </div>

      {deleteFailed && (
        <p className="mt-3 font-mono text-xs text-down" role="alert">
          Couldn't delete this expense. Please try again.
        </p>
      )}

      <SheetFooter>
        <Button variant="secondary" onClick={() => onEdit(item)}>
          Edit expense
        </Button>
        <ConfirmDeleteButton onConfirm={() => void handleDelete()} pending={deleting} />
      </SheetFooter>
    </>
  );
}

export function SpendDetailSheet({ open, item, onClose, onEdit, onDelete }: SpendDetailSheetProps) {
  const editAfterClose = useSheetCloseAction(onEdit);
  const shownItem = useKeepLastNonNull(item);

  return (
    <Sheet
      open={open}
      onOpenChangeComplete={editAfterClose.onOpenChangeComplete}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent>
        {shownItem !== null && (
          <SpendDetailBody
            item={shownItem}
            onClose={onClose}
            onEdit={(itemToEdit) => {
              editAfterClose.defer(itemToEdit);
              onClose();
            }}
            onDelete={onDelete}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
