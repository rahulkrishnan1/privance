import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Shared pill styling for segmented single-select controls. Used by both
 * RadioGroupItem (form fields) and ToggleGroupItem (view state); both render a
 * Radio, so the active state is `data-checked`. Defined once so a segmented
 * control's look cannot drift between screens. The active fill is the brand teal.
 */
export const segmentItemVariants = cva(
  "inline-flex items-center justify-center font-mono uppercase tracking-button text-dim transition ease-out duration-150 cursor-pointer hover:text-cream active:scale-[0.97] motion-reduce:active:scale-100 data-[checked]:bg-accent data-[checked]:text-vault focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
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

const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive ref={ref} className={cn("inline-flex gap-1.5", className)} {...props} />
));
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
