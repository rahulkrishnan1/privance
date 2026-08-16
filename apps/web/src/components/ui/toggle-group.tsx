import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";
import { segmentItemVariants, useSegmentIndicator } from "./radio-group";

type ToggleGroupProps = {
  type?: "single";
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  "aria-label"?: string;
  slidingIndicator?: boolean;
};

function ToggleGroup({
  className,
  children,
  style,
  type: _type,
  value,
  defaultValue,
  onValueChange,
  slidingIndicator = true,
  ...props
}: ToggleGroupProps) {
  const [selectedValue, setSelectedValue] = React.useState(value ?? defaultValue ?? "");
  const currentValue = value ?? selectedValue;
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const indicator = useSegmentIndicator(containerRef, "[data-pressed]");

  return (
    <ToggleGroupPrimitive
      ref={containerRef}
      className={cn("relative inline-flex gap-1.5", className)}
      style={style}
      value={currentValue ? [currentValue] : []}
      onValueChange={(nextValues, eventDetails) => {
        const nextValue = nextValues[0];
        if (nextValue === undefined) {
          eventDetails.cancel();
          return;
        }
        if (value === undefined) setSelectedValue(nextValue);
        onValueChange?.(nextValue);
      }}
      {...props}
    >
      {slidingIndicator && indicator}
      {children}
    </ToggleGroupPrimitive>
  );
}

type ToggleGroupItemProps = React.ComponentPropsWithoutRef<typeof TogglePrimitive> &
  VariantProps<typeof segmentItemVariants>;

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive>,
  ToggleGroupItemProps
>(({ className, size, ...props }, ref) => (
  <TogglePrimitive ref={ref} className={cn(segmentItemVariants({ size, className }))} {...props} />
));
ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem };
