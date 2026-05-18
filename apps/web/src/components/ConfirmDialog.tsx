"use client";

import { useEffect, useRef, useState } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  body: string;
  /** Visible label on the confirmation button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Visual variant of the confirm button. Defaults to "danger". */
  tone?: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
};

/**
 * Generic confirm dialog for destructive or otherwise weighty actions.
 *
 * Uses the native <dialog> element + `showModal()` so Escape, focus trap, and
 * inert-page semantics come for free. The `open`/`dialog.open` guard prevents
 * an InvalidStateError on re-renders.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const confirmClass =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-500"
      : "bg-gold-600 hover:bg-gold-700 focus-visible:ring-gold-500";

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="rounded-2xl p-6 shadow-xl w-full max-w-sm bg-white dark:bg-neutral-900 border-0 backdrop:bg-black/50 focus-visible:outline-none"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-body"
    >
      <h2
        id="confirm-dialog-title"
        className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 mb-3"
      >
        {title}
      </h2>
      <p id="confirm-dialog-body" className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
        {body}
      </p>
      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg px-4 py-2 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-sm font-medium text-neutral-700 dark:text-neutral-300 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none min-h-11 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={busy}
          aria-disabled={busy}
          className={[
            "rounded-lg px-4 py-2 text-white text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none min-h-11 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
            confirmClass,
          ].join(" ")}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
