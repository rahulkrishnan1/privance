/** Returns true when running inside a Capacitor WebView. */
export function isCapacitor(): boolean {
  return (
    typeof window !== "undefined" &&
    (("Capacitor" in window && window.Capacitor !== undefined) ||
      navigator.userAgent.includes("Capacitor"))
  );
}
