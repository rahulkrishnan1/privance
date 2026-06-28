"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function CloseButton({
  onClick,
  label = "Close",
  className,
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex min-h-11 min-w-11 items-center justify-center text-faint hover:text-cream cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
}
