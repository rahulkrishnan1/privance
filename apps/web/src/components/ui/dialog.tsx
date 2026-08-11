import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import * as React from "react";

import { CloseButton } from "@/components/CloseButton";
import { keyboardInsetStyle, useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";
import { overlayClassName } from "./overlay";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;

const DialogBackdrop = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Backdrop>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Backdrop>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Backdrop ref={ref} className={cn(overlayClassName, className)} {...props} />
));
DialogBackdrop.displayName = "DialogBackdrop";

/**
 * Centered dialog on desktop; bottom sheet on phones (<=560px), matching the
 * app's modal feel. No built-in close button: call sites render their own (the
 * shared settings DialogHeader, form headers), so this stays out of their way.
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Popup>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Popup>
>(({ className, children, style, ...props }, ref) => {
  const kb = useKeyboardInset();
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogPrimitive.Popup
        ref={ref}
        // On phones the bottom sheet lifts above the soft keyboard (max-h 90vh
        // when none is shown); see keyboardInsetStyle.
        style={{ ...keyboardInsetStyle(kb, "90vh"), ...style }}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-panel p-6 text-cream shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] outline-none transition-[opacity,transform] duration-200 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150 min-[561px]:data-[starting-style]:scale-95 min-[561px]:data-[ending-style]:scale-95 motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100",
          "max-[560px]:left-0 max-[560px]:top-auto max-[560px]:bottom-(--kb-bottom) max-[560px]:max-h-(--kb-maxh) max-[560px]:max-w-none max-[560px]:translate-x-0 max-[560px]:translate-y-0 max-[560px]:rounded-b-none max-[560px]:rounded-t-2xl max-[560px]:border-x-0 max-[560px]:border-b-0 max-[560px]:data-[starting-style]:translate-y-full max-[560px]:data-[ending-style]:translate-y-full motion-reduce:max-[560px]:data-[starting-style]:translate-y-0 motion-reduce:max-[560px]:data-[ending-style]:translate-y-0",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
});
DialogContent.displayName = "DialogContent";

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
DialogTitle.displayName = "DialogTitle";

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
    <DialogTitle
      id={titleId}
      className="font-serif text-2xl leading-tight font-light tracking-[-0.01em] text-cream"
    >
      {title}
    </DialogTitle>
    <CloseButton onClick={onClose} />
  </div>
);
DialogTitleRow.displayName = "DialogTitleRow";

export { Dialog, DialogContent, DialogFooter, DialogTitle, DialogTitleRow, DialogTrigger };
