"use client";

import type { InputHTMLAttributes } from "react";
import { useId } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  mono?: boolean;
};

export function Input({ label, error, mono, className, id: propId, ...rest }: InputProps) {
  const generatedId = useId();
  const id = propId ?? generatedId;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim"
      >
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        className={[
          "min-h-11 bg-transparent border-b px-1 py-2.5 text-app-text",
          mono ? "font-mono text-sm" : "text-[15px]",
          "placeholder:text-app-dim/70",
          "transition-colors duration-150",
          "focus:outline-none",
          hasError
            ? "border-app-red focus:border-app-red"
            : "border-app-line focus:border-gold-accent",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
      {hasError && (
        <p id={errorId} role="alert" className="text-[13px] text-app-red">
          {error}
        </p>
      )}
    </div>
  );
}
