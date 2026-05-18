"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production builds.
 *
 * Skipped when:
 *  - NODE_ENV !== "production" (dev HMR conflicts with SW caching)
 *  - Running inside a Capacitor WebView (Capacitor manages asset caching itself)
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Capacitor injects window.Capacitor; also guard via UA string for older wrappers.
    const isCapacitor =
      typeof window !== "undefined" &&
      (("Capacitor" in window && window.Capacitor !== undefined) ||
        navigator.userAgent.includes("Capacitor"));
    if (isCapacitor) return;

    // Registration failure is non-fatal; the app works without offline shell.
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return null;
}
