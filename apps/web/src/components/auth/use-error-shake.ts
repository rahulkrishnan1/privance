"use client";

import { useEffect, useState } from "react";

/**
 * Drives a one-shot `auth-shake` class on the auth card whenever a fresh error
 * appears. `errorKey` should change on each distinct error occurrence (a
 * monotonically bumped counter, or the error string itself). The shake itself is
 * inert under prefers-reduced-motion via the CSS keyframe guard.
 */
export function useErrorShake(errorKey: string | number | undefined): boolean {
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    // Falsy covers all "no error yet" sentinels: undefined, "", and the 0 the
    // counter callers start at (the first real error bumps it to 1).
    if (!errorKey) return;
    setShaking(true);
    const id = setTimeout(() => setShaking(false), 400);
    return () => clearTimeout(id);
  }, [errorKey]);

  return shaking;
}
