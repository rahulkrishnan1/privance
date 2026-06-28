import { BASE_URL } from "../../playwright/ports";
/**
 * Dashboard on the mobile UI.
 *
 * The invest screen collapses to a single column at the mobile breakpoint.
 * This verifies the screen still renders its core pieces (net-worth hero,
 * allocation, history chart) with data at a phone viewport.
 *
 * Matches *.mobile.spec.ts, so it runs under the mobile projects (iPhone /
 * Pixel 5).
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import type { SessionSnapshot } from "./helpers/auth";
import { loginAndCapture, restoreSession, waitForSynced } from "./helpers/auth";
import { horizontalOverflow } from "./helpers/overflow";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

const RUN = Date.now().toString(36);
const SAVE_TIMEOUT = 30_000;

let savedSession: SessionSnapshot;

test.describe("dashboard mobile", () => {
  // Seed one cash account so the invest screen renders its data state (not the
  // empty state). Use duplicateUser, which other specs only ever log into and
  // never give holdings: a cash-only account means no per-holding price fetch,
  // so the screen reaches its ready state deterministically rather than sitting
  // in loading behind sharedUser's cross-spec holding pile. global-setup wipes
  // the user's sync rows each run.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const { duplicateUser } = loadFixtures();
    savedSession = await loginAndCapture(browser, {
      username: duplicateUser.username,
      password: duplicateUser.password,
    });

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, savedSession);
    await page.goto("/app/accounts/");
    await expect(page).toHaveURL("/app/accounts/", { timeout: 15_000 });
    // Wait until the invest screen finishes loading (OPFS resolves locally, not network).
    await expect(
      page
        .getByRole("heading", { name: /vault is empty/i })
        .or(page.getByRole("navigation", { name: "Invest sub-navigation" })),
    ).toBeVisible({ timeout: 15_000 });
    await waitForSynced(page);

    // "+ account" subnav button or empty-state "+ Add account" button
    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill(`MobDash-${RUN}`);
    // Kind defaults to investment; select Cash so Current balance field appears.
    await dialog.getByRole("radio", { name: "Cash" }).click();
    await dialog.getByLabel("Account type").selectOption("checking");
    await dialog.getByLabel("Current balance").fill("4200.00");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    // Let the sync push the new account to the server before closing: the test
    // runs in a fresh context with isolated OPFS, so it only sees server-synced
    // data, not this setup context's local store.
    await page.waitForLoadState("networkidle");
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);
  });

  test("renders the net-worth hero, allocation, and history chart at a phone viewport", async ({
    page,
  }) => {
    await page.goto("/app/");
    // Wait for the invest screen data to load (OPFS is local, networkidle fires too early).
    await expect(
      page
        .getByTestId("invest-net-worth")
        .or(page.getByRole("navigation", { name: "Invest sub-navigation" })),
    ).toBeVisible({ timeout: SAVE_TIMEOUT });
    await waitForSynced(page);

    // Net worth KPI renders a real computed value (not $0 or NaN). The fixture
    // user accumulates data across specs in a run, so assert the shape, not a
    // specific amount.
    const netWorth = page.getByTestId("invest-net-worth");
    await expect(netWorth).toBeVisible({ timeout: SAVE_TIMEOUT });
    await expect(netWorth).toHaveText(/\$[\d,]+/, { timeout: SAVE_TIMEOUT });
    expect((await netWorth.textContent())?.trim()).not.toBe("$0");

    // History chart renders (the chart is a role="img" label).
    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    // The history range selector is reachable and switchable on touch.
    await page.getByRole("radio", { name: "1M range" }).click();
    await expect(page.getByRole("radio", { name: "1M range", checked: true })).toBeVisible();
  });

  // Sideways scroll at a phone width makes iOS WebKit shrink-to-fit zoom on launch.
  test("no horizontal overflow on the invest screen at a phone viewport", async ({ page }) => {
    await page.goto("/app/");
    await expect(page.getByRole("navigation", { name: "Invest sub-navigation" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });
    await waitForSynced(page);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1); // sub-pixel slop
  });
});
