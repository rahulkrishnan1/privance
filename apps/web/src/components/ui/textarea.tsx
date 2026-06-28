"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-line bg-panel-2 px-3.5 py-3 font-mono text-base text-cream outline-none transition-colors placeholder:text-faint focus:border-accent-dim disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-signal",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
