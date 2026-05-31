"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
};

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

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      className="m-auto rounded-2xl p-6 shadow-xl w-full max-w-sm bg-app-panel border border-app-line backdrop:bg-black/50 focus-visible:outline-none"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-body"
    >
      <h2
        id="confirm-dialog-title"
        className="font-serif text-[22px] leading-tight font-light tracking-[-0.015em] text-app-text mb-3"
        style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
      >
        {title}
      </h2>
      <p id="confirm-dialog-body" className="text-[14px] text-app-muted mb-6">
        {body}
      </p>
      <div className="flex gap-3 justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy} size="sm">
          Cancel
        </Button>
        <Button
          type="button"
          variant={tone === "danger" ? "danger" : "primary"}
          onClick={() => void handleConfirm()}
          disabled={busy}
          loading={busy}
          size="sm"
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
