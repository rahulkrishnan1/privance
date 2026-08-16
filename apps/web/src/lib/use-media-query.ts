import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query. Returns false during SSR and the first client
 * render (no window), then the real match after mount, so it never causes a
 * hydration mismatch. Mirrors the matchMedia pattern in use-chart-colors.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** Returns null until the browser reports the user's reduced-motion preference. */
export function usePrefersReducedMotion(): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return matches;
}
