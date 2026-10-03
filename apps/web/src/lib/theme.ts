import { useCallback, useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "privance.theme.v1";
export const THEME_CHANGE_EVENT = "privance-theme-change";
export const DEFAULT_THEME_PREFERENCE = "dark" as const;

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const DARK_THEME_COLOR = "#07080a";
const LIGHT_THEME_COLOR = "#f6f7f5";
let sessionPreference: ThemePreference | null = null;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  if (sessionPreference !== null) return sessionPreference;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
    return DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
    sessionPreference = null;
  } catch {
    // Display preferences are best-effort in private or restricted browsing.
    sessionPreference = preference;
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}

function readSystemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

function updateThemeColor(doc: Document, resolved: ResolvedTheme): void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  const manifest = doc.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest) manifest.href = resolved === "dark" ? "/manifest.json" : "/manifest-light.json";
}

function preferenceFromEvent(event: Event): ThemePreference | undefined {
  const detail = (event as CustomEvent<unknown>).detail;
  return isThemePreference(detail) ? detail : undefined;
}

export function applyThemePreference(
  preference: ThemePreference,
  doc: Document = document,
  systemPrefersDark = readSystemPrefersDark(),
): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark);
  doc.documentElement.classList.toggle("dark", resolved === "dark");
  doc.documentElement.dataset.theme = resolved;
  doc.documentElement.style.colorScheme = resolved;
  updateThemeColor(doc, resolved);
  return resolved;
}

export function setThemePreference(preference: ThemePreference): void {
  writeThemePreference(preference);
  applyThemePreference(preference);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
}

export function useThemePreference(): readonly [
  ThemePreference,
  (preference: ThemePreference) => void,
] {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    const handleChange = (event: Event) =>
      setPreference(preferenceFromEvent(event) ?? readThemePreference());
    window.addEventListener(THEME_CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleChange);
  }, []);

  const update = useCallback((next: ThemePreference) => setThemePreference(next), []);
  return [preference, update];
}

export function startThemeController(): () => void {
  let systemPreference: MediaQueryList | null = null;
  try {
    systemPreference = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    applyThemePreference(readThemePreference(), document, true);
    return () => undefined;
  }
  const applyCurrent = (preference = readThemePreference()) =>
    applyThemePreference(preference, document, systemPreference?.matches ?? true);
  const handleSystemChange = () => {
    const preference = readThemePreference();
    if (preference === "system") applyCurrent(preference);
  };
  const handlePreferenceChange = (event: Event) => {
    const preference = preferenceFromEvent(event);
    if (preference === undefined) return applyCurrent();
    if (
      document.documentElement.dataset.theme !==
      resolveTheme(preference, systemPreference?.matches ?? true)
    ) {
      applyCurrent(preference);
    }
  };

  applyCurrent();
  if (typeof systemPreference.addEventListener === "function") {
    systemPreference.addEventListener("change", handleSystemChange);
  } else {
    systemPreference.addListener(handleSystemChange);
  }
  window.addEventListener(THEME_CHANGE_EVENT, handlePreferenceChange);

  return () => {
    if (typeof systemPreference?.removeEventListener === "function") {
      systemPreference.removeEventListener("change", handleSystemChange);
    } else {
      systemPreference?.removeListener(handleSystemChange);
    }
    window.removeEventListener(THEME_CHANGE_EVENT, handlePreferenceChange);
  };
}
