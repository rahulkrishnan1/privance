import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  readThemePreference,
  resolveTheme,
  setThemePreference,
  startThemeController,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  writeThemePreference,
} from "./theme";

const realLocalStorage = globalThis.localStorage;

beforeEach(() => {
  writeThemePreference("dark");
  realLocalStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.head.querySelector('meta[name="theme-color"]')?.remove();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.localStorage = realLocalStorage;
});

describe("theme preference", () => {
  it("defaults to dark so existing users keep the current appearance", () => {
    expect(readThemePreference()).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("resolves System from the operating-system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("dark");
  });

  it("applies the resolved theme and browser chrome metadata", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    document.head.append(manifest);

    applyThemePreference("light", document, false);

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(meta.content).toBe("#f6f7f5");
    expect(manifest.href).toContain("/manifest-light.json");
  });

  it("applies a preference even when localStorage is unavailable", () => {
    const failingStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as Storage;
    globalThis.localStorage = failingStorage;

    setThemePreference("light");

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows System changes and removes both listeners on dispose", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let systemMatches = false;
    const media = {
      get matches() {
        return systemMatches;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    } as MediaQueryList;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => media),
    );
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    const removeSystemListener = vi.spyOn(media, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");

    const stop = startThemeController();
    expect(document.documentElement.dataset.theme).toBe("light");

    systemMatches = true;
    for (const listener of listeners) listener(new Event("change") as MediaQueryListEvent);
    expect(document.documentElement.dataset.theme).toBe("dark");

    localStorage.setItem(THEME_STORAGE_KEY, "light");
    for (const listener of listeners) listener(new Event("change") as MediaQueryListEvent);
    expect(document.documentElement.dataset.theme).toBe("dark");
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    expect(document.documentElement.dataset.theme).toBe("light");

    stop();
    expect(removeSystemListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith(THEME_CHANGE_EVENT, expect.any(Function));
  });

  it("keeps a selected preference in memory when persistence is blocked", () => {
    const failingStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    globalThis.localStorage = failingStorage;

    setThemePreference("light");

    expect(readThemePreference()).toBe("light");
  });

  it("keeps following System when storage can be read but not written", () => {
    let systemMatches = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      get matches() {
        return systemMatches;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    } as MediaQueryList;
    globalThis.localStorage = {
      getItem: () => "dark",
      setItem: () => {
        throw new Error("writes blocked");
      },
    } as unknown as Storage;
    vi.stubGlobal("matchMedia", () => media);

    const stop = startThemeController();
    setThemePreference("system");

    for (const matches of [true, false]) {
      systemMatches = matches;
      for (const listener of listeners) listener(new Event("change") as MediaQueryListEvent);
      expect(document.documentElement.dataset.theme).toBe(matches ? "dark" : "light");
    }

    stop();
  });

  it("keeps rendering when matchMedia is unavailable", () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => {
        throw new Error("unsupported");
      },
    });
    localStorage.setItem(THEME_STORAGE_KEY, "dark");

    expect(() => startThemeController()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });
});
