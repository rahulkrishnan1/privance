import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Shared pill styling for segmented single-select controls. The active fill is
 * painted by the sliding indicator, not by the item itself.
 */
export const segmentItemVariants = cva(
  "relative inline-flex items-center justify-center font-mono uppercase tracking-button text-dim transition ease-out duration-150 cursor-pointer hover:text-cream active:scale-[0.97] motion-reduce:active:scale-100 data-[checked]:text-vault data-[pressed]:text-vault focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
  {
    variants: {
      size: {
        sm: "min-h-9 rounded-md px-3 py-1.5 text-xs",
        md: "min-h-11 rounded-md px-4 py-2.5 text-xs sm:min-h-10",
      },
    },
    defaultVariants: { size: "md" },
  },
);

// Internal — merge multiple refs into a single callback for use with primitives.
function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (value: T) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref && "current" in ref) (ref as React.MutableRefObject<T>).current = value;
    }
  };
}

/** Raw position + size of a target element relative to the container. */
export type SegmentPosition = {
  width: number;
  height: number;
  left: number;
  top: number;
  borderRadius: string;
};

/**
 * Measure position + size of the target element (`selector`) relative to the
 * container. Default selector is `[data-checked]` for the segment-indicator
 * pill; consumers (e.g. subnav underline) pass their own active selector.
 */
export function measureSegmentIndicator(
  container: HTMLElement,
  selector = "[data-checked]",
): SegmentPosition | null {
  const target = container.querySelector<HTMLElement>(selector);
  if (!target) return null;
  const cRect = container.getBoundingClientRect();
  const iRect = target.getBoundingClientRect();
  return {
    width: iRect.width,
    height: iRect.height,
    left: iRect.left - cRect.left,
    top: iRect.top - cRect.top,
    // Match the target element's border-radius so rounded-full / rounded-[5px] /
    // rounded-md containers get the right pill shape without a prop.
    borderRadius: getComputedStyle(target).borderRadius,
  };
}

/**
 * Shared measurement hook — returns raw position + size of a target element
 * relative to the container. Handles mount measurement, re-render tracking,
 * and ResizeObserver. Callers build their own indicator element from the
 * returned data (e.g. a full-height pill or a bottom underline).
 */
export function useSegmentPosition(
  containerRef: React.RefObject<HTMLElement | null>,
  selector?: string,
): SegmentPosition | null {
  const [pos, setPos] = React.useState<SegmentPosition | null>(null);

  // Measure on mount and on every render (catches value changes). Use a
  // functional setState with an identity check to avoid an infinite loop:
  // setPos fires a re-render, which would re-run the layout effect and
  // call setPos again — but the functional updater returns the same
  // reference when nothing changed, so React skips the redundant render.
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = measureSegmentIndicator(container, selector);
    setPos((prev) => {
      if (
        prev?.width === next?.width &&
        prev?.height === next?.height &&
        prev?.left === next?.left &&
        prev?.top === next?.top &&
        prev?.borderRadius === next?.borderRadius
      ) {
        return prev;
      }
      return next;
    });
  });

  // Re-measure on container resize (font load, zoom, window resize).
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      setPos(measureSegmentIndicator(container, selector));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, selector]);

  return pos;
}

/**
 * Sliding pill indicator for segmented controls — shared between RadioGroup
 * and ToggleGroup. Returns a span positioned over the checked item that glides
 * between selections via CSS transform transition.
 */
export function useSegmentIndicator(
  containerRef: React.RefObject<HTMLElement | null>,
  selector = "[data-checked]",
) {
  const pos = useSegmentPosition(containerRef, selector);
  if (!pos) return null;

  const style: React.CSSProperties = {
    width: pos.width,
    height: pos.height,
    transform: `translate(${pos.left}px, ${pos.top}px)`,
    borderRadius: pos.borderRadius,
  };

  return (
    <span
      aria-hidden
      className="absolute top-0 left-0 pointer-events-none bg-[var(--segment-active-bg,var(--color-accent))] transition-transform duration-200 ease-[var(--ease-in-out)] will-change-transform motion-reduce:transition-none"
      style={style}
    />
  );
}

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive> & {
    slidingIndicator?: boolean;
  }
>(({ className, children, slidingIndicator = true, ...props }, ref) => {
  const containerRef = React.useRef<HTMLElement | null>(null);
  const indicator = useSegmentIndicator(containerRef);

  return (
    <RadioGroupPrimitive
      ref={mergeRefs(ref, containerRef)}
      className={cn("relative inline-flex gap-1.5", className)}
      {...props}
    >
      {slidingIndicator && indicator}
      {children}
    </RadioGroupPrimitive>
  );
});
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioPrimitive.Root> &
    VariantProps<typeof segmentItemVariants>
>(({ className, size, children, ...props }, ref) => (
  <RadioPrimitive.Root
    ref={ref}
    className={cn(segmentItemVariants({ size, className }))}
    {...props}
  >
    {children}
  </RadioPrimitive.Root>
));
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
