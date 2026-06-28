"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Inline chevron so the control renders identically across browsers (native
// select arrows differ); paired with appearance-none below. Kept as a native
// <select> on purpose: it gives the OS picker on mobile, which a custom
// listbox can't match for touch and accessibility.
const CHEVRON =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path d='M5.5 7.5l4.5 4.5 4.5-4.5' stroke='%235e5e5a' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")";

type SelectProps = React.ComponentProps<"select"> & {
  /** Renders the error border when the field is invalid. */
  invalid?: boolean;
};

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ invalid = false, className, style, children, ...props }, ref) => (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "min-h-11 w-full cursor-pointer appearance-none rounded-lg border bg-panel-2 pr-9 pl-3.5 py-3 font-mono text-base text-cream outline-none transition-colors focus:border-accent-dim disabled:cursor-not-allowed disabled:opacity-50",
        invalid ? "border-signal" : "border-line",
        className,
      )}
      // Chevron geometry stays inline, not as bg-[...] utilities: tailwind-merge
      // treats those arbitrary background values as conflicting with bg-panel-2
      // and strips the fill, leaving the control transparent.
      style={{
        backgroundImage: CHEVRON,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
        backgroundSize: "14px",
        ...style,
      }}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export { Select };
