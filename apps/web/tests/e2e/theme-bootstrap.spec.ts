import { expect, test } from "@playwright/test";

const themes = [
  { name: "default", preference: null, system: "light", resolved: "dark" },
  {
    name: "saved Light",
    preference: "light",
    system: "dark",
    resolved: "light",
  },
  { name: "System with light OS", preference: "system", system: "light", resolved: "light" },
  { name: "System with dark OS", preference: "system", system: "dark", resolved: "dark" },
] as const;

for (const { name, preference, system, resolved } of themes) {
  test(`${name} theme applies before app startup`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript(
      ({ storedPreference, rejectMatchMedia }) => {
        if (storedPreference !== null) localStorage.setItem("privance.theme.v1", storedPreference);
        if (rejectMatchMedia) {
          Object.defineProperty(window, "matchMedia", {
            configurable: true,
            value: () => {
              throw new Error("matchMedia unavailable");
            },
          });
        }
      },
      { storedPreference: preference, rejectMatchMedia: preference === "light" },
    );
    await page.route("**/assets/*.js", (route) => route.abort());
    await page.goto("/unlock");

    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-theme", resolved);
    await expect(root).toHaveCSS("color-scheme", resolved);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      resolved === "dark" ? "#07080a" : "#f6f7f5",
    );
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      resolved === "dark" ? "/manifest.json" : "/manifest-light.json",
    );
    await expect(page.locator("#root")).toBeEmpty();
  });
}
