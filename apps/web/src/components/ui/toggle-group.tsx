import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { RadioGroupItem } from "./radio-group";

// A single-select segmented control for view state (nav tabs, chart ranges) as
// opposed to RadioGroup for form fields. Its items are RadioGroupItem (identical
// pill + radio a11y); the distinct group name keeps call-site intent readable.
// `type="single"` is accepted for call-site compatibility and has no effect
// (multi-select is not supported).
type ToggleGroupProps = {
  type?: "single";
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children?: React.ReactNode;
  "aria-label"?: string;
};

function ToggleGroup({ className, type: _type, ...props }: ToggleGroupProps) {
  return <RadioGroupPrimitive className={cn("inline-flex gap-1.5", className)} {...props} />;
}

export { RadioGroupItem as ToggleGroupItem, ToggleGroup };
