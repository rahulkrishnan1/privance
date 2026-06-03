/**
 * Session persistence + lock on the mobile UI.
 *
 * Covers the mobile differences from the desktop session spec: there is no
 * top-bar Lock button at the mobile breakpoint, so locking is reached through
 * the Settings screen (bottom-tab nav). Also re-checks the survive-refresh and
 * lock-on-cold-launch behavior at a phone viewport.
 *
 * Matches *.mobile.spec.ts, so it runs under the mobile projects (iPhone /
 * Pixel 5).
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

// Two Argon2id derivations across the file dominate wall-clock.
test.setTimeout(90_000);

async function loginMobile(page: import("@playwright/test").Page, user: Fixtures["duplicateUser"]) {
  await page.goto("/auth/login/");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Master password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
}

test.describe("session mobile", () => {
  test("survives a refresh, and Lock from Settings ends the session", async ({ page }) => {
    const { duplicateUser } = loadFixtures();
    await loginMobile(page, duplicateUser);

    // Survive refresh: a same-tab reload stays on the app, no /unlock.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });

    // Mobile lock lives in Settings (no top-bar Lock at this breakpoint).
    // Dispatch the click straight to the link so the dev-server-only Next.js
    // overlay pinned over the tab bar cannot intercept it (absent in prod).
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await nav.getByRole("link", { name: "Settings" }).dispatchEvent("click");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });
  });

  test("an installed PWA locks on cold relaunch", async ({ page }) => {
    const { duplicateUser } = loadFixtures();
    // Emulate an installed standalone PWA (the iOS home-screen surface): force
    // the display-mode query isStandalonePwa() reads, so a cold launch re-locks.
    await page.context().addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query.includes("display-mode: standalone")
          ? ({
              matches: true,
              media: query,
              onchange: null,
              addEventListener() {},
              removeEventListener() {},
              addListener() {},
              removeListener() {},
              dispatchEvent: () => false,
            } as MediaQueryList)
          : original(query);
    });

    await loginMobile(page, duplicateUser);

    // Pull-to-refresh (a reload) still survives.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });

    // Cold launch (fresh navigation, as on reopening a closed PWA) re-locks. The
    // re-lock redirects to /unlock mid-load, which interrupts this navigation on
    // some engines; that redirect is the behavior under test, so tolerate it.
    await page.goto("/app/").catch(() => {});
    await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });
  });
});
