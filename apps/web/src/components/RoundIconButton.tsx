"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function RoundIconButton({
  onClick,
  label,
  title,
  pressed,
  disabled,
  children,
  className,
}: {
  onClick: () => void;
  label: string;
  title?: string;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-default",
        pressed
          ? "border-accent-dim text-accent"
          : "border-line text-dim hover:border-accent-dim hover:text-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}
