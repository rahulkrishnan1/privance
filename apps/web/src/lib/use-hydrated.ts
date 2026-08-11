import { useEffect, useState } from "react";

/**
 * False on the first client render, true once the mount effect has run. The
 * app is a pure SPA (no SSR), so this guards the one-frame window where the
 * shell has rendered but effects have not flushed — gating interactive
 * controls on it avoids a silent no-op tap on a not-yet-wired control on
 * slow cold loads (notably WebKit and the installed PWA).
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
