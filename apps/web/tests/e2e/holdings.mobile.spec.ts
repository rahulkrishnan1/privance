/**
 * Holdings mobile tap targets.
 *
 * On mobile the Day, Price, Avg cost, Total cost, and Weight columns are hidden;
 * only Holding, G/L, and Value are visible. Tapping any cell in a holding row
 * opens the holding detail sheet (a bottom sheet / dialog) with position details.
 *
 * This file matches *.mobile.spec.ts and runs exclusively under the mobile
 * Playwright projects (Pixel 5, iPhone 14), where detail columns are hidden and
 * the row-tap path is exercised.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { loginAndCapture, restoreSession, tapNav, waitForSynced } from "./helpers/auth";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

const RUN = Date.now().toString(36);
const INVESTMENT_ACCOUNT_NAME = `MobBrokerage-${RUN}`;

let savedSession: SessionSnapshot;

test.describe("holdings mobile", () => {
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

    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);
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
    const holdingRow = page.getByRole("button", {
      name: new RegExp(`${ticker}.*open holding details`),
    });
    await expect(holdingRow).toBeVisible({ timeout: 5_000 });
    await tapNav(holdingRow);

    // The detail sheet (dialog) must open and show position rows.
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    // Sheet shows the ticker prominently and Position KV rows.
    await expect(sheet.getByText(ticker)).toBeVisible({ timeout: 5_000 });
    await expect(sheet.getByText("Quantity", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(sheet.getByText("Account", { exact: true })).toBeVisible({ timeout: 5_000 });
  });
});
