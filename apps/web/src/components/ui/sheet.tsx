"use client";

import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";

import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { cn } from "@/lib/utils";
import { overlayClassName } from "./overlay";

const Sheet = SheetPrimitive.Root;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay ref={ref} className={cn(overlayClassName, className)} {...props} />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

/**
 * Right-rail panel on desktop; bottom sheet on phones (<=560px). One bespoke
 * responsive shape (not shadcn's side variants) so it matches the app's detail
 * panels. No built-in close button: call sites render their own header + close.
 */
const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>
>(({ className, children, style, ...props }, ref) => {
  const kb = useKeyboardInset();
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        // On phones the sheet lifts above the soft keyboard and caps its height
        // to the space left, so its top content stays visible. Defaults
        // reproduce the keyboard-free layout (bottom: 0, max-height: 88vh).
        style={
          {
            "--kb-bottom": `${kb.height}px`,
            "--kb-maxh": kb.available != null ? `${kb.available}px` : "88vh",
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "fixed right-0 top-0 bottom-0 z-50 h-dvh w-[440px] max-w-[100vw] overflow-auto border-l border-line bg-panel p-7 text-cream shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] outline-none transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-300 data-[state=closed]:duration-300 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
          "max-[560px]:inset-x-0 max-[560px]:top-auto max-[560px]:bottom-(--kb-bottom) max-[560px]:h-auto max-[560px]:max-h-(--kb-maxh) max-[560px]:w-auto max-[560px]:rounded-t-2xl max-[560px]:border-l-0 max-[560px]:border-t max-[560px]:data-[state=open]:slide-in-from-bottom max-[560px]:data-[state=closed]:slide-out-to-bottom",
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn(className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

export { Sheet, SheetContent, SheetTitle };
