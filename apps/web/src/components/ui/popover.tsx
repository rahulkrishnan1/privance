"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

type PositionerProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Positioner>;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Popup>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Popup> & {
    align?: PositionerProps["align"];
    side?: PositionerProps["side"];
    sideOffset?: PositionerProps["sideOffset"];
  }
>(({ className, align = "center", side = "bottom", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    {/* z-index lives on the Positioner (the fixed-positioned element) so the
        popover layers above a surrounding modal Dialog's z-50 backdrop; a z on
        the Popup alone only stacks within the Positioner's own context. */}
    <PopoverPrimitive.Positioner
      align={align}
      side={side}
      sideOffset={sideOffset}
      className="z-[60]"
    >
      <PopoverPrimitive.Popup
        ref={ref}
        data-slot="popover-content"
        className={cn(
          "w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none origin-(--transform-origin) transition-[opacity,transform] duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverContent, PopoverTrigger };
