import { BASE_URL } from "../../playwright/ports";
/**
 * Holdings mobile tap targets.
 *
 * Before the fix, the row-expand disclosure was on a button inside the ticker
 * cell only. Tapping the Value or G/L % cell (the only other mobile-visible
 * cells) did nothing. The fix moved the disclosure to the whole <tr>, so
 * tapping any visible cell expands the detail sub-row.
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
import { loginAndCapture, restoreSession } from "./helpers/auth";

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
    await expect(
      page
        .getByRole("heading", { name: "Accounts" })
        .or(page.getByRole("heading", { name: "Add your first account" })),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Account name").fill(INVESTMENT_ACCOUNT_NAME);
    await dialog.getByRole("button", { name: "Investment" }).click();
    await dialog.getByLabel("Balance").fill("0.00");
    await dialog.getByRole("button", { name: "Save" }).click();
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

  test("tapping the Value cell of a holding row expands the detail sub-row (regression)", async ({
    page,
  }) => {
    await page.goto("/app/holdings/");
    await expect(page.getByRole("heading", { name: "Holdings", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForLoadState("networkidle");

    const ticker = `MOB${RUN.slice(-4).toUpperCase()}`;
    await page.getByRole("button", { name: "Add holding" }).first().click();
    const addDialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("Ticker").fill(ticker);
    const listbox = addDialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await addDialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await addDialog.getByLabel("Shares").fill("5");
    await addDialog.getByLabel("Avg cost per share").fill("100.00");
    await addDialog.getByRole("button", { name: "Save" }).click();
    await expect(addDialog).not.toBeVisible({ timeout: 15_000 });

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable).toBeVisible({ timeout: 10_000 });
    await expect(holdingsTable.getByText(ticker)).toBeVisible({ timeout: 10_000 });

    // Only the data row has aria-expanded; the collapsed detail sub-row does not.
    const holdingRow = holdingsTable
      .locator("tr[aria-expanded]")
      .filter({ hasText: ticker })
      .first();

    await expect(holdingRow).toHaveAttribute("aria-expanded", "false");

    // On mobile only Ticker, Value, and G/L % cells are visible (the rest are
    // md:hidden). Tap td index 5 (Value cell) to prove a non-ticker cell works.
    //
    // locator.tap() fires the full pointer+touch sequence AND the synthetic click
    // event React's onClick listens for. page.touchscreen.tap() would not.
    await holdingRow.locator("td").nth(5).tap();

    // The detail sub-row must now be visible. Use aria-controls to scope the
    // assertion to the exact sub-row, avoiding the nav "Accounts" link text.
    await expect(holdingRow).toHaveAttribute("aria-expanded", "true", { timeout: 5_000 });
    const subRowId = await holdingRow.getAttribute("aria-controls");
    const subRow = page.locator(`#${subRowId}`);
    await expect(subRow).toBeVisible({ timeout: 5_000 });
    await expect(subRow.getByText("Account")).toBeVisible({ timeout: 5_000 });
    await expect(subRow.getByText("Shares")).toBeVisible({ timeout: 5_000 });
  });
});
