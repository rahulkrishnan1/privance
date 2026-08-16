import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import * as React from "react";

import { keyboardInsetStyle, useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";
import { overlayClassName } from "./overlay";

const Sheet = SheetPrimitive.Root;
const SheetPortal = SheetPrimitive.Portal;

const SheetBackdrop = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Backdrop>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Backdrop>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Backdrop ref={ref} className={cn(overlayClassName, className)} {...props} />
));
SheetBackdrop.displayName = "SheetBackdrop";

/**
 * Right-rail panel on desktop; bottom sheet on phones (<=560px). One bespoke
 * responsive shape (not shadcn's side variants) so it matches the app's detail
 * panels. No built-in close button: call sites render their own header + close.
 */
const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Popup>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Popup>
>(({ className, children, style, ...props }, ref) => {
  const kb = useKeyboardInset();
  return (
    <SheetPortal>
      <SheetBackdrop />
      <SheetPrimitive.Popup
        ref={ref}
        // On phones the sheet lifts above the soft keyboard (max-h 88vh when
        // none is shown); see keyboardInsetStyle.
        style={{ ...keyboardInsetStyle(kb, "88vh"), ...style }}
        className={cn(
          // Gentler not zero: keep an opacity fade under reduced motion for state
          // legibility (vestibular-safe), while dropping the position change.
          "fixed right-0 top-0 bottom-0 z-50 h-dvh w-[440px] max-w-[100vw] overflow-auto border-l border-line bg-panel p-7 text-cream shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] outline-none transition-transform duration-300 ease-drawer data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full data-[ending-style]:duration-200 motion-reduce:transition-opacity motion-reduce:duration-150 motion-reduce:data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-x-0 motion-reduce:data-[ending-style]:translate-x-0",
          "max-[560px]:inset-x-0 max-[560px]:top-auto max-[560px]:bottom-(--kb-bottom) max-[560px]:h-auto max-[560px]:max-h-(--kb-maxh) max-[560px]:w-auto max-[560px]:rounded-t-2xl max-[560px]:border-l-0 max-[560px]:border-t max-[560px]:data-[starting-style]:translate-x-0 max-[560px]:data-[starting-style]:translate-y-full max-[560px]:data-[ending-style]:translate-x-0 max-[560px]:data-[ending-style]:translate-y-full motion-reduce:max-[560px]:data-[starting-style]:translate-y-0 motion-reduce:max-[560px]:data-[ending-style]:translate-y-0",
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Popup>
    </SheetPortal>
  );
});
SheetContent.displayName = "SheetContent";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn(className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";

export { Sheet, SheetContent, SheetTitle };
