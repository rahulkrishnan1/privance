"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

export function SwUpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const isCapacitor =
      typeof window !== "undefined" &&
      (("Capacitor" in window && window.Capacitor !== undefined) ||
        navigator.userAgent.includes("Capacitor"));
    if (isCapacitor) return;

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;

      const trackInstalling = (sw: ServiceWorker) => {
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller !== null) {
            setWaiting(sw);
          }
        });
      };

      if (reg.installing) trackInstalling(reg.installing);

      reg.addEventListener("updatefound", () => {
        if (reg.installing) trackInstalling(reg.installing);
      });
    });
  }, []);

  if (!waiting) return null;

  function handleUpdate() {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
      once: true,
    });
    waiting.postMessage({ type: "SKIP_WAITING" });
    setWaiting(null);
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-app-line bg-app-panel px-4 py-3 shadow-lg"
    >
      <span className="text-[13px] text-app-text">Update available</span>
      <button
        type="button"
        onClick={handleUpdate}
        className="text-[13px] font-medium text-gold-accent hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-accent cursor-pointer"
      >
        Reload
      </button>
      <button
        type="button"
        onClick={() => setWaiting(null)}
        aria-label="Dismiss"
        className="text-app-dim hover:text-app-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-accent cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  );
}
