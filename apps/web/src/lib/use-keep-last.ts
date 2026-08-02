"use client";

import { useEffect, useState } from "react";

/**
 * Keeps the last non-null value while the live value is null. Used to keep a
 * detail sheet's content mounted during its exit transition after the detail
 * row is deselected: the caller sets `value` to null on close and keeps
 * rendering the sheet against the retained last value.
 */
export function useKeepLastNonNull<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(null);

  useEffect(() => {
    if (value !== null) setLast(value);
  }, [value]);

  return value ?? last;
}
