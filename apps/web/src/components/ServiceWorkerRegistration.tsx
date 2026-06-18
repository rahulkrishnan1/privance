"use client";

import { useEffect } from "react";
import { isCapacitor } from "./capacitor";

// Registers /sw.js in production. Skipped in dev (HMR conflicts with SW caching)
// and inside Capacitor (it manages asset caching itself).
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    if (isCapacitor()) return;

    // Registration failure is non-fatal; the app works without the offline shell.
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return null;
}
