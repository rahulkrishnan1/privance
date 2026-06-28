"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";

import { CloseButton } from "@/components/CloseButton";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";
import { overlayClassName } from "./overlay";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn(overlayClassName, className)} {...props} />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Centered dialog on desktop; bottom sheet on phones (<=560px), matching the
 * app's modal feel. No built-in close button: call sites render their own (the
 * shared settings DialogHeader, form headers), so this stays out of their way.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, ...props }, ref) => {
  const kb = useKeyboardInset();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        // On phones the bottom sheet lifts above the soft keyboard and caps its
        // height to the space left, so the focused input stays visible.
        // Defaults reproduce the keyboard-free layout (bottom: 0, max-h: 90vh).
        style={
          {
            "--kb-bottom": `${kb.height}px`,
            "--kb-maxh": kb.available != null ? `${kb.available}px` : "90vh",
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-panel p-6 text-cream shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "max-[560px]:left-0 max-[560px]:top-auto max-[560px]:bottom-(--kb-bottom) max-[560px]:max-h-(--kb-maxh) max-[560px]:max-w-none max-[560px]:translate-x-0 max-[560px]:translate-y-0 max-[560px]:rounded-b-none max-[560px]:rounded-t-2xl max-[560px]:border-x-0 max-[560px]:border-b-0 max-[560px]:data-[state=open]:slide-in-from-bottom max-[560px]:data-[state=closed]:slide-out-to-bottom",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

// Equal-width buttons on one row at every width (the app's dialog-footer
// convention), not shadcn's stack-on-mobile / right-align default.
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex gap-2.5 [&>*]:flex-1", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn(className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-dim", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

const DialogTitleRow = ({
  title,
  titleId,
  onClose,
}: {
  title: React.ReactNode;
  titleId: string;
  onClose: () => void;
}) => (
  <div className="flex items-center justify-between">
    <DialogTitle asChild>
      <h2
        id={titleId}
        className="font-serif text-2xl leading-tight font-light tracking-[-0.01em] text-cream"
      >
        {title}
      </h2>
    </DialogTitle>
    <CloseButton onClick={onClose} />
  </div>
);
DialogTitleRow.displayName = "DialogTitleRow";

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTitleRow,
  DialogTrigger,
};
