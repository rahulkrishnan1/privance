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
import { loginAndCapture, restoreSession, waitForSynced } from "./helpers/auth";

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

  // Dispatch click directly to the link element to avoid any overlay intercepting
  // coordinate-based clicks on the fixed bottom tab bar.
  const tap = (link: import("@playwright/test").Locator) => link.dispatchEvent("click");

  test("the bottom tab bar routes between the four screens", async ({ page }) => {
    await page.goto("/app");
    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    // Settle the initial local-store load + first sync before asserting per-screen
    // content: the Plan heading is gated on the accounts/plan queries leaving
    // "initialising", so navigating before sync races them on a slow runner.
    await waitForSynced(page);

    // Spend tab -> spend screen, and the tab marks itself current.
    await tap(nav.getByRole("link", { name: "Spend" }));
    await expect(page).toHaveURL(/\/app\/spend\/?$/, { timeout: 10_000 });
    // A fresh user has no recurring items, so the Spend screen shows its empty state.
    await expect(page.getByRole("heading", { name: /Nothing recurring/ })).toBeVisible({
      timeout: 10_000,
    });
    await expect(nav.getByRole("link", { name: "Spend" })).toHaveAttribute("aria-current", "page");

    // Plan tab -> plan screen, and the tab marks itself current. The plan screen
    // heading is dynamic: the empty state reads "Project your path to
    // independence." (h2) and a computed plan reads "Independent by {year}..."
    // (h1), so match the shared "independ" stem rather than a level or exact text.
    await tap(nav.getByRole("link", { name: "Plan" }));
    await expect(page).toHaveURL(/\/app\/plan\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /independ/i })).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");

    // Settings tab -> settings screen. The page heading confirms the route; the
    // Lock affordance lives only in the top bar now, not as a settings row.
    await tap(nav.getByRole("link", { name: "Settings" }));
    await expect(page).toHaveURL(/\/app\/settings\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /The vault/i })).toBeVisible({
      timeout: 10_000,
    });

    // Invest tab -> back to the invest screen. Its content is gated on the
    // OPFS-backed net-worth query whose timing depends on cross-spec fixture
    // state, so this routing test asserts the route and the active-tab marker
    // (the Invest screen's own rendering is covered by dashboard.mobile.spec).
    await tap(nav.getByRole("link", { name: "Invest" }));
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    await expect(nav.getByRole("link", { name: "Invest" })).toHaveAttribute("aria-current", "page");
  });
});
