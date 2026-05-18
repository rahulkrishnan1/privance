"use client";

import type { InputHTMLAttributes } from "react";
import { useId } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export function Input({ label, error, className, id: propId, ...rest }: InputProps) {
  const generatedId = useId();
  const id = propId ?? generatedId;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        className={[
          "min-h-11 rounded-lg border px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-50",
          "bg-white dark:bg-neutral-900",
          "placeholder:text-neutral-400 dark:placeholder:text-neutral-600",
          "transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none",
          hasError
            ? "border-red-500 focus-visible:ring-red-400"
            : "border-neutral-300 dark:border-neutral-700",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
      {hasError && (
        <p id={errorId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
