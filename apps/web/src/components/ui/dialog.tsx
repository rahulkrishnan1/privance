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
 * Centered dialog on desktop; bottom sheet below the md breakpoint, matching the
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
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-panel p-6 text-cream shadow-[0_24px_60px_-20px_var(--surface-shadow)] outline-none transition-[opacity,transform] duration-200 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[ending-style]:duration-150 md:data-[starting-style]:scale-95 md:data-[ending-style]:scale-95 motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100 max-md:transition-transform max-md:duration-300 max-md:ease-drawer max-md:motion-reduce:transition-opacity max-md:motion-reduce:duration-150",
          "max-md:left-0 max-md:top-auto max-md:bottom-(--kb-bottom) max-md:max-h-(--kb-maxh) max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0 max-md:data-[starting-style]:translate-y-full max-md:data-[ending-style]:translate-y-full motion-reduce:max-md:data-[starting-style]:translate-y-0 motion-reduce:max-md:data-[ending-style]:translate-y-0",
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
// convention), not shadcn's stack-on-mobile / right-align default. Form
// dialogs and sheets use the sticky treatment so actions remain reachable while
// their content scrolls.
const DialogFooter = ({
  className,
  sticky = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { sticky?: boolean }) => (
  <div
    className={cn(
      "flex gap-2.5 [&>*]:flex-1",
      sticky &&
        "sticky bottom-0 z-10 -mx-1 mt-5 border-t border-line bg-panel/95 px-1 pt-4 pb-[max(0px,env(safe-area-inset-bottom))] backdrop-blur-md",
      className,
    )}
    {...props}
  />
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
