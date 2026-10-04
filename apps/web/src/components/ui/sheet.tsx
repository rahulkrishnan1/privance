import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import * as React from "react";

import { CloseButton } from "@/components/CloseButton";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { DialogFooter } from "./dialog";
import { overlayClassName } from "./overlay";

type SheetProps = React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Root>;

/**
 * Responsive detail drawer: a right-side rail on larger screens and a
 * swipe-to-dismiss bottom sheet on compact surfaces. Base UI owns focus, dismissal,
 * gestures, and scroll locking; a shared viewport inset keeps mobile content above
 * the software keyboard.
 */
function Sheet({ swipeDirection, ...props }: SheetProps) {
  // Keep the JS behavior aligned with Tailwind's md breakpoint (768px).
  // Tailwind's max-md variant applies below 768px, so 767px is the matching
  // inclusive browser width for the media query.
  const isPhone = useMediaQuery("(max-width: 767px)");
  return (
    <DrawerPrimitive.Root
      swipeDirection={swipeDirection ?? (isPhone ? "down" : "right")}
      {...props}
    />
  );
}

function useSheetCloseAction<T>(onComplete: (value: T) => void) {
  const pending = React.useRef<{ value: T } | null>(null);
  return {
    defer: (value: T) => {
      pending.current = { value };
    },
    onOpenChangeComplete: (open: boolean) => {
      if (open) {
        pending.current = null;
        return;
      }
      const action = pending.current;
      pending.current = null;
      if (action !== null) onComplete(action.value);
    },
  };
}

const SheetBackdrop = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Backdrop>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Backdrop>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Backdrop
    ref={ref}
    className={cn(
      overlayClassName,
      "opacity-[calc(1-var(--drawer-swipe-progress))] data-swiping:duration-0",
      className,
    )}
    {...props}
  />
));
SheetBackdrop.displayName = "SheetBackdrop";

type SheetContentProps = React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Popup> & {
  scrollable?: boolean;
};

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Popup>,
  SheetContentProps
>(({ className, children, scrollable = true, style, ...props }, ref) => {
  return (
    <DrawerPrimitive.VirtualKeyboardProvider>
      <DrawerPrimitive.Portal>
        <SheetBackdrop />
        <DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex items-stretch justify-end max-md:items-end max-md:justify-stretch">
          <DrawerPrimitive.Popup
            ref={ref}
            style={style}
            className={cn(
              "group/drawer-popup relative flex h-dvh w-[440px] max-w-[100vw] flex-col overflow-hidden border-l border-line bg-panel text-cream shadow-[0_24px_60px_-20px_var(--surface-shadow)] outline-none overscroll-contain touch-auto",
              "[transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-[220ms] ease-drawer will-change-transform data-swiping:select-none data-swiping:duration-0 data-[swipe-direction=right]:data-[starting-style]:translate-x-full data-[swipe-direction=right]:data-[ending-style]:translate-x-full data-[ending-style]:duration-[calc(var(--drawer-swipe-strength)*220ms)]",
              "max-md:mb-[var(--drawer-keyboard-inset,0px)] max-md:h-auto max-md:max-h-[min(82dvh,calc(100dvh-var(--drawer-keyboard-inset,0px)))] max-md:w-full max-md:rounded-t-[22px] max-md:border-l-0 max-md:border-t max-md:[transform:translateY(var(--drawer-swipe-movement-y))] max-md:data-[swipe-direction=down]:data-[starting-style]:translate-y-full max-md:data-[swipe-direction=down]:data-[ending-style]:translate-y-full",
              "motion-reduce:transition-opacity motion-reduce:duration-150 motion-reduce:data-[starting-style]:opacity-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-x-0 motion-reduce:data-[ending-style]:translate-x-0 motion-reduce:max-md:data-[starting-style]:translate-y-0 motion-reduce:max-md:data-[ending-style]:translate-y-0",
              className,
            )}
            {...props}
          >
            <div
              aria-hidden
              className="mx-auto mt-2.5 hidden h-1 w-9 shrink-0 rounded-full bg-cream/20 max-md:block"
            />
            <DrawerPrimitive.Content
              className={cn(
                "flex min-h-0 flex-1 flex-col overscroll-contain p-7 max-md:p-5 max-md:pt-3",
                scrollable ? "overflow-y-auto" : "overflow-hidden",
              )}
            >
              {children}
            </DrawerPrimitive.Content>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.VirtualKeyboardProvider>
  );
});
SheetContent.displayName = "SheetContent";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title ref={ref} className={cn(className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";

const SheetBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  ),
);
SheetBody.displayName = "SheetBody";

const SheetTitleRow = ({
  title,
  titleId,
  onClose,
}: {
  title: React.ReactNode;
  titleId: string;
  onClose: () => void;
}) => (
  <div className="flex items-center justify-between">
    <SheetTitle
      id={titleId}
      className="font-serif text-2xl leading-tight font-light tracking-[-0.01em] text-cream"
    >
      {title}
    </SheetTitle>
    <CloseButton onClick={onClose} />
  </div>
);
SheetTitleRow.displayName = "SheetTitleRow";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <DialogFooter sticky className={cn("mt-auto", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

export {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetTitle,
  SheetTitleRow,
  useSheetCloseAction,
};
