"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3.5 py-3 font-mono text-base text-cream outline-none transition-colors placeholder:text-faint focus:border-accent-dim disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-signal",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
