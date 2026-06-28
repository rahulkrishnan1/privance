"use client";

import type { ComponentProps } from "react";
import { forwardRef, useId } from "react";
import { Label } from "@/components/ui/label";
import { Select as SelectControl } from "@/components/ui/select";

type SelectProps = ComponentProps<"select"> & {
  label: string;
  error?: string;
};

/**
 * Mirrors the composite `Input` so the forms stop re-implementing the
 * label/error/aria-describedby trio.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, id: propId, children, ...rest },
  ref,
) {
  const generatedId = useId();
  const id = propId ?? generatedId;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <SelectControl
        ref={ref}
        id={id}
        invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        {...rest}
      >
        {children}
      </SelectControl>
      {hasError && (
        <p id={errorId} role="alert" className="text-sm text-signal">
          {error}
        </p>
      )}
    </div>
  );
});
