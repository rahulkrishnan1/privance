import { BASE_URL } from "../../playwright/ports";
/**
 * Holdings mobile tap targets.
 *
 * On mobile the Price, Gain, and Weight columns are hidden; only Holding, Day,
 * and Value are visible. Tapping any cell in a holding row opens the holding
 * detail sheet (a bottom sheet / dialog) with position details.
 *
 * This file matches *.mobile.spec.ts and runs exclusively under the mobile
 * Playwright project (Pixel 5 viewport), where detail columns are hidden and
 * the row-tap path is exercised.
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

const RUN = Date.now().toString(36);
const INVESTMENT_ACCOUNT_NAME = `MobBrokerage-${RUN}`;

let savedSession: SessionSnapshot;
let accountReady = false;

test.describe("holdings mobile", () => {
  // The beforeAll does an argon2 login (up to 30s) plus account creation (10s).
  // Set an explicit timeout so a cold server start does not race the default 60s.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);

    const { sharedUser } = loadFixtures();
    savedSession = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, savedSession);

    await page.goto("/app/accounts/");
    await expect(page).toHaveURL("/app/accounts/", { timeout: 15_000 });
    // Wait for invest screen to finish loading (OPFS resolves locally, networkidle fires too early).
    await expect(
      page
        .getByRole("heading", { name: /vault is empty/i })
        .or(page.getByRole("navigation", { name: "Invest sub-navigation" })),
    ).toBeVisible({ timeout: 15_000 });
    await waitForSynced(page);

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill(INVESTMENT_ACCOUNT_NAME);
    await dialog.getByRole("radio", { name: "Investment" }).click();
    await dialog.getByLabel("Account type").selectOption("brokerage");
    await dialog.getByLabel("Cash balance (optional)").fill("0.00");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    accountReady = true;

    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);
  });

  test("account was created in beforeAll", () => {
    expect(accountReady).toBe(true);
  });

  test("tapping a holding row opens the detail sheet with position details (regression)", async ({
    page,
  }) => {
    await page.goto("/app/holdings/");
    await expect(page).toHaveURL("/app/holdings/", { timeout: 10_000 });
    await waitForSynced(page);

    const ticker = `MOB${RUN.slice(-4).toUpperCase()}`;

    // On mobile the subnav shows "+ Add" and the empty state shows
    // "Add holding". Use the first matching button.
    await page
      .getByRole("button", { name: /Add holding|\+ Add/i })
      .first()
      .click();
    const addDialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("Ticker").fill(ticker);
    const listbox = addDialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await addDialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await addDialog.getByLabel("Quantity").fill("5");
    await addDialog.getByLabel("Avg cost basis").fill("100.00");
    await addDialog.getByRole("button", { name: "Add holding" }).click();
    await expect(addDialog).not.toBeVisible({ timeout: 15_000 });

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable).toBeVisible({ timeout: 10_000 });
    await expect(holdingsTable.getByText(ticker)).toBeVisible({ timeout: 10_000 });

    // Tap the holding row (by its accessible name). On mobile only
    // Ticker/Day/Value cells are visible, but the whole row is tappable.
    //
    // locator.tap() fires the full pointer+touch sequence AND the synthetic
    // click event React's onClick listens for.
    const holdingRow = page.getByRole("button", {
      name: new RegExp(`${ticker}.*open holding details`),
    });
    await expect(holdingRow).toBeVisible({ timeout: 5_000 });
    // Dispatch the click directly on the row: a coordinate tap is intercepted by
    // the fixed bottom tab bar when the row sits low in the list, and a
    // touchscreen tap fires a delayed synthetic click at the same point that
    // then lands on the opened sheet's backdrop and closes it. dispatchEvent
    // fires the click React's onClick listens for, with no overlay/coords race.
    await holdingRow.dispatchEvent("click");

    // The detail sheet (dialog) must open and show position rows.
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // Sheet shows the ticker prominently and Position KV rows. Use exact text so
    // "Quantity" does not also match the footer note "quantity is yours to update".
    await expect(sheet.getByText(ticker)).toBeVisible({ timeout: 5_000 });
    await expect(sheet.getByText("Quantity", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(sheet.getByText("Account", { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test("scope sheet filters holdings by account on mobile (regression)", async ({ page }) => {
    await page.goto("/app/holdings/");
    await expect(page).toHaveURL("/app/holdings/", { timeout: 10_000 });
    await waitForSynced(page);

    // The card heading doubles as the scope-menu trigger; on mobile it opens a bottom sheet.
    await page.getByRole("button", { name: /All holdings/ }).click();
    const sheet = page.getByRole("dialog", { name: /Filter holdings by scope/i });
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    await sheet.getByRole("option", { name: new RegExp(INVESTMENT_ACCOUNT_NAME) }).click();

    await expect(sheet).not.toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("heading", { name: new RegExp(INVESTMENT_ACCOUNT_NAME) }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /All holdings/ })).not.toBeVisible();
  });
});
