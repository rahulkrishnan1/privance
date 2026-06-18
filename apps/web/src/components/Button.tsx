"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-vault hover:bg-accent-hover active:bg-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  secondary:
    "bg-transparent border border-line text-cream hover:border-cream-soft/40 hover:bg-white/[0.03] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  danger:
    "bg-down text-vault hover:bg-down/90 active:bg-down disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-down",
  ghost:
    "bg-transparent text-cream-soft hover:text-cream disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 py-2.5 text-[12px] sm:min-h-9 sm:py-1.5 sm:text-[13px]",
  md: "min-h-9 px-4 py-2 text-[13px] sm:min-h-10 sm:px-5 sm:text-sm",
  lg: "min-h-10 px-5 py-2 text-sm sm:min-h-11 sm:px-7 sm:py-2.5",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...rest}
      disabled={isDisabled}
      aria-busy={loading}
      className={[
        "inline-flex items-center justify-center rounded-full font-medium tracking-tight",
        "transition-colors duration-150",
        "cursor-pointer disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <Spinner />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
