"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md font-mono text-xs uppercase tracking-button transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary: "bg-accent text-vault hover:bg-cream focus-visible:outline-accent",
        secondary:
          "border border-line bg-transparent text-cream hover:border-cream-soft/40 hover:bg-white/[0.03] focus-visible:outline-accent",
        danger: "bg-down text-vault hover:bg-down/90 active:bg-down focus-visible:outline-down",
        dangerOutline:
          "border border-down/35 bg-transparent text-down hover:bg-down/10 focus-visible:outline-down",
        ghost: "bg-transparent text-cream-soft hover:text-cream focus-visible:outline-accent",
      },
      size: {
        sm: "min-h-11 px-3 py-2.5 sm:min-h-9 sm:py-1.5",
        md: "min-h-11 px-4 py-2 sm:min-h-10 sm:px-5",
        // No min-height, so a caller that drives the box off a CSS var (the
        // calendar's --cell-size) can override height cleanly.
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Spinner />
            {children}
          </span>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
