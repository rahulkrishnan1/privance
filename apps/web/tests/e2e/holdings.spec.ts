import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { loginAndCapture, restoreSession, waitForSynced } from "./helpers/auth";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

const RUN = Date.now().toString(36);

let savedSession: SessionSnapshot;

let investmentAccountCreated = false;
const INVESTMENT_ACCOUNT_NAME = `Holdings-Brokerage-${RUN}`;

async function goToHoldings(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app/holdings/");
  await expect(page).toHaveURL(/\/app\/holdings\/?$/, { timeout: 10_000 });
  // Wait until the invest screen has finished loading: either the holdings table
  // (populated) or the empty-state heading.
  await expect(
    page
      .getByRole("table", { name: "Holdings" })
      .or(page.getByRole("heading", { name: /Track your portfolio/i })),
  ).toBeVisible({ timeout: 15_000 });
  await waitForSynced(page);
}

async function openAddHoldingDialog(page: import("@playwright/test").Page): Promise<void> {
  await page
    .getByRole("button", { name: /Add holding|\+ holding/i })
    .first()
    .click();
}

test.describe("holdings", () => {
  test.beforeAll(async ({ browser }) => {
    const { sharedUser } = loadFixtures();
    savedSession = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });

    // Create the investment account using a fresh page that has the DEK injected.
    if (!investmentAccountCreated) {
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      const page = await ctx.newPage();
      await restoreSession(page, savedSession);

      await page.goto("/app/accounts/");
      await expect(page).toHaveURL(/\/app\/accounts\/?$/, { timeout: 15_000 });
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
      await expect(dialog).not.toBeVisible({ timeout: 30_000 });
      investmentAccountCreated = true;

      await ctx.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);
  });

  test("investment account was created in beforeAll", () => {
    // Guard: if beforeAll silently failed, every subsequent holdings test would
    // pass vacuously (no account → no add-holding dialog). This makes that failure loud.
    expect(investmentAccountCreated).toBe(true);
  });

  test("creates a holding via ticker and sees it in the table", async ({ page }) => {
    await goToHoldings(page);

    await openAddHoldingDialog(page);

    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    // Type ticker; the combobox may trigger autocomplete
    const tickerInput = dialog.getByLabel("Ticker");
    await tickerInput.fill("AAPL");

    // Dismiss any autocomplete dropdown that may appear
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const option = listbox.locator('[role="option"]').filter({ hasText: "AAPL" }).first();
      if ((await option.count()) > 0) {
        await option.click({ force: true });
      } else {
        await page.keyboard.press("Escape");
      }
    }

    // Select the investment account
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Quantity").fill("10");
    await dialog.getByLabel("Avg cost basis").fill("150.00");
    await dialog.getByRole("button", { name: "Add holding" }).click();

    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Holdings table should show AAPL
    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable).toBeVisible({ timeout: 10_000 });
    await expect(holdingsTable.getByText("AAPL").first()).toBeVisible();
  });

  test("top holding navigation preserves the current Invest scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto("/app/");
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("table", { name: "Top holdings" })).toBeVisible({
      timeout: 15_000,
    });
    await waitForSynced(page);

    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      window.scrollTo(0, 320);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const initialScroll = await page.evaluate(() => window.scrollY);

    await page.getByRole("button", { name: /AAPL, open holding details/ }).click();
    await expect(page).toHaveURL(/\/app\/holdings\/?$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScroll);
    await expect(page.locator("main")).toBeFocused();
  });

  test("edits a holding's shares and cost basis", async ({ page }) => {
    await goToHoldings(page);

    // AAPL should be visible (created in previous test, same user+DB)
    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText("AAPL").first()).toBeVisible({ timeout: 10_000 });

    // Click the AAPL row to open the detail sheet
    await page
      .getByRole("button", { name: /AAPL.*open holding details/ })
      .first()
      .click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Edit holding" }).click();
    const editDialog = page.getByRole("dialog", { name: /Edit holding/i });
    await expect(editDialog).toBeVisible({ timeout: 5_000 });

    const sharesInput = editDialog.getByLabel("Quantity");
    await sharesInput.clear();
    await sharesInput.fill("20");

    const costInput = editDialog.getByLabel("Avg cost basis");
    await costInput.clear();
    await costInput.fill("160.00");

    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    await expect(holdingsTable.getByText("AAPL").first()).toBeVisible();
  });

  test("deletes a holding", async ({ page }) => {
    await goToHoldings(page);

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText("AAPL").first()).toBeVisible({ timeout: 10_000 });

    // Count AAPL rows before deletion (may be > 1 if prior runs left stale data)
    const aaplBefore = await holdingsTable.getByText("AAPL").count();

    // Open the AAPL detail sheet and delete (two-tap)
    await page
      .getByRole("button", { name: /AAPL.*open holding details/ })
      .first()
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Delete" }).click();
    await expect(sheet.getByRole("button", { name: "Tap again to delete" })).toBeVisible({
      timeout: 3_000,
    });
    await sheet.getByRole("button", { name: "Tap again to delete" }).click();

    // Verify the sheet closes (proves deletion was accepted) and the AAPL row count dropped.
    await expect(sheet).not.toBeVisible({ timeout: 10_000 });

    if (aaplBefore <= 1) {
      // Only one AAPL existed; table may disappear entirely after deletion.
      const tableVisible = await holdingsTable.isVisible({ timeout: 2_000 }).catch(() => false);
      if (tableVisible) {
        await expect(holdingsTable.getByText("AAPL")).not.toBeVisible({ timeout: 5_000 });
      }
    } else {
      // Multiple AAPL rows: expect count to decrease by exactly one.
      await expect(holdingsTable.getByText("AAPL")).toHaveCount(aaplBefore - 1, {
        timeout: 5_000,
      });
    }
  });

  async function getMarketValueCell(
    page: import("@playwright/test").Page,
    ticker: string,
  ): Promise<ReturnType<import("@playwright/test").Page["locator"]>> {
    // Rows carry aria-label "{ticker}, open holding details" and tag the value
    // cell with data-testid="holding-value". Scope to the last matching row: the
    // E2E DB can hold several rows for one ticker (they accumulate across browser
    // projects), so an unscoped lookup would be ambiguous. The word boundary
    // stops a prefix ticker (e.g. GOOGL) from matching a shorter one (GOOG).
    const row = page.getByRole("button", {
      name: new RegExp(`${ticker}\\b.*open holding details`),
    });
    return row.last().getByTestId("holding-value");
  }

  async function addStockHolding(
    page: import("@playwright/test").Page,
    opts: { ticker: string; shares: string; avgCost: string },
  ): Promise<void> {
    await openAddHoldingDialog(page);
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Ticker").fill(opts.ticker);
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Quantity").fill(opts.shares);
    await dialog.getByLabel("Avg cost basis").fill(opts.avgCost);
    await dialog.getByRole("button", { name: "Add holding" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  }

  test("crypto asset type routes through CoinGecko (regression)", async ({ page }) => {
    await goToHoldings(page);

    await openAddHoldingDialog(page);
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    // Switch to Crypto, enter a slug (not an exchange ticker).
    await dialog.getByRole("radio", { name: "Crypto" }).click();
    await dialog.getByLabel("CoinGecko ID").fill("bitcoin");
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Quantity").fill("0.1");
    await dialog.getByLabel("Avg cost basis").fill("50000.00");
    await dialog.getByRole("button", { name: "Add holding" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Regression: every ticker used to be routed to Yahoo, so crypto slugs
    // returned "-" forever. The assetType-aware router now hits CoinGecko.
    const cell = await getMarketValueCell(page, "bitcoin");
    await expect(cell).toContainText("$", { timeout: 60_000 });
  });

  test("deleting one holding preserves other rows' prices (regression)", async ({ page }) => {
    await goToHoldings(page);

    // Two fresh priced holdings; deleting one must not blank the other's price.
    await addStockHolding(page, { ticker: "GOOG", shares: "5", avgCost: "100.00" });
    await addStockHolding(page, { ticker: "NVDA", shares: "5", avgCost: "100.00" });

    const googCell = await getMarketValueCell(page, "GOOG");
    const nvdaCell = await getMarketValueCell(page, "NVDA");
    await expect(googCell).toContainText("$", { timeout: 60_000 });
    await expect(nvdaCell).toContainText("$", { timeout: 60_000 });

    // Regression: pre-cache implementation rebuilt the prices map on every
    // query-key change, briefly emptying every row's price column on delete.
    await page
      .getByRole("button", { name: /NVDA.*open holding details/ })
      .first()
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Delete" }).click();
    await expect(sheet.getByRole("button", { name: "Tap again to delete" })).toBeVisible({
      timeout: 3_000,
    });
    await sheet.getByRole("button", { name: "Tap again to delete" }).click();
    await expect(sheet).not.toBeVisible({ timeout: 10_000 });

    // GOOG's market value must still be a dollar amount, never a "-" flash.
    await expect(googCell).toContainText("$");
  });

  test("deleted holding stays deleted after a page reload", async ({ page }) => {
    await goToHoldings(page);

    await openAddHoldingDialog(page);
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    const ticker = `TST${RUN.slice(-4).toUpperCase()}`;
    await dialog.getByLabel("Ticker").fill(ticker);
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Quantity").fill("1");
    await dialog.getByLabel("Avg cost basis").fill("10.00");
    await dialog.getByRole("button", { name: "Add holding" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText(ticker)).toBeVisible({ timeout: 10_000 });

    // Open detail sheet and delete (two-tap)
    await page
      .getByRole("button", { name: new RegExp(`${ticker}.*open holding details`) })
      .first()
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Delete" }).click();
    await expect(sheet.getByRole("button", { name: "Tap again to delete" })).toBeVisible({
      timeout: 3_000,
    });
    await sheet.getByRole("button", { name: "Tap again to delete" }).click();
    await expect(sheet).not.toBeVisible({ timeout: 10_000 });

    await page.reload();
    await waitForSynced(page);
    // Regression: pull-without-version-guard used to clobber an unacked local
    // tombstone with the server's pre-delete copy on reload.
    await expect(holdingsTable).toBeVisible({ timeout: 10_000 });
    await expect(holdingsTable.getByText(ticker)).not.toBeVisible({ timeout: 5_000 });
  });

  test("deep-link from top-holdings row highlights the row then clears", async ({ page }) => {
    // Create a holding so the dashboard overview shows it in the top-holdings table.
    await goToHoldings(page);
    const ticker = `HL${RUN.slice(-4).toUpperCase()}`;
    await addStockHolding(page, { ticker, shares: "5", avgCost: "100.00" });

    // Navigate to the dashboard (overview) page.
    await page.goto("/app/");
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    await waitForSynced(page);

    // Wait for the top-holdings table to appear.
    const topTable = page.getByRole("table", { name: "Top holdings" });
    await expect(topTable).toBeVisible({ timeout: 15_000 });

    // Click the row for our holding.
    const topRow = page.getByRole("button", {
      name: new RegExp(`${ticker}\\b.*open holding details`),
    });
    await expect(topRow).toBeVisible();
    await topRow.first().click();

    // Should land on the full holdings list.
    await expect(page).toHaveURL(/\/app\/holdings\/?$/, { timeout: 10_000 });
    await waitForSynced(page);

    // The targeted row should show the highlight attribute.
    // Playwright locators are lazy — re-queries the DOM after the second
    // navigation below, so this reference is still valid.
    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable).toBeVisible({ timeout: 10_000 });
    await expect(holdingsTable.locator('tr[data-highlight="true"]')).toBeVisible({
      timeout: 3_000,
    });

    // After the ~2s flash animation completes, the attribute should be gone.
    await expect(holdingsTable.locator('tr[data-highlight="true"]')).not.toBeVisible({
      timeout: 3_500,
    });

    // Direct navigation must NOT show any highlighted row.
    await page.goto("/app/holdings/");
    await expect(page).toHaveURL(/\/app\/holdings\/?$/, { timeout: 10_000 });
    await waitForSynced(page);
    await expect(holdingsTable).toBeVisible({ timeout: 10_000 });
    await expect(holdingsTable.locator('tr[data-highlight="true"]')).not.toBeVisible({
      timeout: 2_000,
    });
  });
});
