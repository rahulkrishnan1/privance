"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

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
    "bg-gold-accent text-app-bg hover:bg-gold-accent-hover active:bg-gold-accent disabled:opacity-50 focus-visible:ring-gold-accent/40",
  secondary:
    "bg-transparent border border-app-line text-app-text hover:border-app-muted/40 hover:bg-white/[0.03] disabled:opacity-50 focus-visible:ring-gold-accent/40",
  danger:
    "bg-app-red text-app-bg hover:bg-app-red/90 active:bg-app-red disabled:opacity-50 focus-visible:ring-app-red/40",
  ghost:
    "bg-transparent text-app-muted hover:text-app-text disabled:opacity-50 focus-visible:ring-gold-accent/40",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-9 px-4 py-2 text-[13px]",
  md: "min-h-11 px-6 py-2.5 text-sm",
  lg: "min-h-12 px-7 py-3 text-sm",
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
      className={[
        "inline-flex items-center justify-center rounded-full font-medium tracking-tight",
        "transition-colors duration-150",
        "focus-visible:ring-2 focus-visible:outline-none",
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
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
