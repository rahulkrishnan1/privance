"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  /** "center" = centered dialog (forms, confirms). "sheet" = right panel on
   *  desktop, bottom sheet on mobile (detail views). */
  variant?: "center" | "sheet";
  labelledBy?: string;
  describedBy?: string;
  /** Extra classes for the dialog box (e.g. max-width on center modals). */
  className?: string;
  children: ReactNode;
};

const EXIT_MS = 300;

// Ref-counted body scroll lock so a stacked modal (e.g. a sheet opening another)
// keeps scroll locked until the last one closes, then restores the original.
let scrollLockCount = 0;
let savedBodyOverflow = "";

/**
 * Shared modal/sheet primitive. Wraps a native <dialog> (showModal gives
 * focus-trap, ESC, return-focus, and an inert background for free) and adds:
 * backdrop-click close, body scroll-lock, and slide/fade in-out transitions.
 */
export function Modal({
  open,
  onClose,
  variant = "center",
  labelledBy,
  describedBy,
  className,
  children,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // `mounted` keeps the dialog open through the exit transition; `shown` drives
  // the transform/opacity so entry animates one frame after showModal().
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (mounted && !dialog.open) {
      dialog.showModal();
      // showModal() lands focus on the first focusable child (the close button),
      // painting its focus ring on open. Focus the dialog instead: keyboard Tab
      // still rings controls, and screen readers announce the title.
      dialog.focus();
      requestAnimationFrame(() => setShown(true));
    }
  }, [mounted]);

  useEffect(() => {
    if (!open && mounted) {
      setShown(false);
      const t = setTimeout(() => {
        dialogRef.current?.close();
        setMounted(false);
      }, EXIT_MS);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (scrollLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLockCount++;
    return () => {
      scrollLockCount--;
      if (scrollLockCount === 0) document.body.style.overflow = savedBodyOverflow;
    };
  }, [mounted]);

  if (!mounted) return null;

  const box =
    variant === "sheet"
      ? [
          // left-auto + explicit height override the native <dialog> UA rules
          // (left:0, height:fit-content); without them the panel pins left and
          // collapses to content height instead of a full-height right rail.
          "fixed top-0 bottom-0 right-0 left-auto m-0 h-dvh w-[440px] max-w-[100vw] overflow-auto border-l border-line p-7",
          "max-[560px]:top-auto max-[560px]:inset-x-0 max-[560px]:bottom-0 max-[560px]:h-auto max-[560px]:w-auto max-[560px]:max-h-[88vh] max-[560px]:border-l-0 max-[560px]:border-t max-[560px]:rounded-t-2xl",
          "transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
          shown
            ? "translate-x-0 max-[560px]:translate-y-0"
            : "translate-x-full max-[560px]:translate-x-0 max-[560px]:translate-y-full",
        ].join(" ")
      : [
          "m-auto w-full max-w-md rounded-2xl border border-line p-6",
          // On mobile, anchor to the bottom as a sheet (slide up) instead of
          // floating centered; mirrors the "sheet" variant's mobile rules.
          "max-[560px]:top-auto max-[560px]:bottom-0 max-[560px]:inset-x-0 max-[560px]:m-0 max-[560px]:w-auto max-[560px]:max-w-none max-[560px]:max-h-[90vh] max-[560px]:overflow-auto max-[560px]:rounded-b-none max-[560px]:rounded-t-2xl max-[560px]:border-x-0 max-[560px]:border-b-0",
          "transition-[opacity,transform] duration-200 ease-out max-[560px]:duration-300 max-[560px]:ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
          shown
            ? "opacity-100 scale-100 max-[560px]:translate-y-0"
            : "opacity-0 scale-95 max-[560px]:opacity-100 max-[560px]:scale-100 max-[560px]:translate-y-full",
        ].join(" ");

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      // Handle ESC here (not onCancel) so it runs the exit animation, and so the
      // backdrop onClick is paired with a keyboard handler on the same element.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className={`bg-panel text-cream focus-visible:outline-none ${box} ${className ?? ""}`}
    >
      {children}
    </dialog>
  );
}
