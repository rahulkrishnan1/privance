/**
 * Mobile bottom-tab navigation.
 *
 * On desktop the primary nav is a top bar; at the mobile breakpoint it is a
 * fixed bottom tab bar (the top bar is md:hidden). This spec exercises that
 * mobile-only control: each tab routes to its screen and marks itself current.
 *
 * Matches *.mobile.spec.ts, so it runs under the mobile projects (iPhone /
 * Pixel 5) where the bottom bar is the visible navigation.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import type { SessionSnapshot } from "./helpers/auth";
import { loginAndCapture, restoreSession } from "./helpers/auth";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

let savedSession: SessionSnapshot;

test.describe("mobile navigation", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const { sharedUser } = loadFixtures();
    savedSession = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);
  });

  // The Next.js dev overlay (dev server only, absent in the production PWA) is
  // pinned to a bottom corner over the fixed tab bar, and a coordinate click,
  // even forced, routes to it. Dispatch the click straight to the link element
  // instead; the Next <Link> onClick still fires and navigates.
  const tap = (link: import("@playwright/test").Locator) => link.dispatchEvent("click");

  test("the bottom tab bar routes between the four screens", async ({ page }) => {
    await page.goto("/app/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    // Holdings tab -> holdings screen, and the tab marks itself current.
    await tap(nav.getByRole("link", { name: "Holdings" }));
    await expect(page).toHaveURL(/\/app\/holdings\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Holdings", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(nav.getByRole("link", { name: "Holdings" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Accounts tab -> accounts screen.
    await tap(nav.getByRole("link", { name: "Accounts" }));
    await expect(page).toHaveURL(/\/app\/accounts\/?$/, { timeout: 10_000 });
    await expect(
      page
        .getByRole("heading", { name: "Accounts" })
        .or(page.getByRole("heading", { name: "Add your first account" })),
    ).toBeVisible({ timeout: 10_000 });

    // Settings tab -> settings screen, where the mobile lock/sign-out live.
    await tap(nav.getByRole("link", { name: "Settings" }));
    await expect(page).toHaveURL(/\/app\/settings\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Lock" })).toBeVisible();

    // Dashboard tab -> back to the dashboard.
    await tap(nav.getByRole("link", { name: "Dashboard" }));
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10_000 });
  });
});
