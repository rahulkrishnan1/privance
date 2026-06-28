"use client";

import type { InputHTMLAttributes } from "react";
import { forwardRef, useId } from "react";
import { Input as InputControl } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

/**
 * Labelled form field: the shared `ui/input` control plus a label and inline
 * error, wired together for accessibility. The bare control lives in
 * `ui/input`; this is the app-level field built on it. forwardRef so a
 * react-hook-form Controller's `field.ref` reaches the input (focus-on-error).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id: propId, ...rest },
  ref,
) {
  const generatedId = useId();
  const id = propId ?? generatedId;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <InputControl
        ref={ref}
        id={id}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        {...rest}
      />
      {hasError && (
        <p id={errorId} role="alert" className="text-sm text-signal">
          {error}
        </p>
      )}
    </div>
  );
});
