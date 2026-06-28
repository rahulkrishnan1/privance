"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Shared pill styling for segmented single-select controls. Used by both
 * RadioGroupItem (form fields, `data-state=checked`) and ToggleGroupItem
 * (view state, `data-state=on`), so a segmented control's look is defined once
 * and cannot drift between screens. The active fill is the brand teal.
 */
export const segmentItemVariants = cva(
  "inline-flex items-center justify-center font-mono uppercase tracking-button text-dim transition-colors cursor-pointer hover:text-cream data-[state=checked]:bg-accent data-[state=checked]:text-vault data-[state=on]:bg-accent data-[state=on]:text-vault focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
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
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn("inline-flex gap-1.5", className)} {...props} />
));
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> &
    VariantProps<typeof segmentItemVariants>
>(({ className, size, children, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(segmentItemVariants({ size, className }))}
    {...props}
  >
    {children}
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
