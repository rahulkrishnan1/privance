"use client";

import { useEffect, useState } from "react";

/**
 * False during SSR and the first client render, true once the mount effect has
 * run (i.e. after React has hydrated). Gate interactive controls on this so a
 * tap on a not-yet-hydrated control is never a silent no-op, which is the
 * documented failure mode on slow cold loads (notably WebKit and the installed
 * PWA, where the static HTML paints well before hydration attaches handlers).
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
