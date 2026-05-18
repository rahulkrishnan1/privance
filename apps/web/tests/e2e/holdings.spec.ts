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

// ---------------------------------------------------------------------------
// Session state shared across all tests in this file.
// Login once in beforeAll (capturing DEK via exposeFunction before hard nav),
// then inject DEK + cookies in beforeEach so we only burn one login attempt
// against the per-username rate limit (5/min).
// ---------------------------------------------------------------------------

let savedSession: SessionSnapshot;

// ---------------------------------------------------------------------------
// One-time setup: create the investment account that holdings tests need.
// ---------------------------------------------------------------------------

let investmentAccountCreated = false;
const INVESTMENT_ACCOUNT_NAME = `Holdings-Brokerage-${RUN}`;

// ---------------------------------------------------------------------------
// Helper: navigate to Holdings page (requires beforeEach to have set up auth)
// ---------------------------------------------------------------------------

async function goToHoldings(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/holdings/");
  await expect(page).toHaveURL("/holdings/", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Holdings", exact: true })).toBeVisible({
    timeout: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Holdings CRUD
// ---------------------------------------------------------------------------

test.describe("holdings", () => {
  test.beforeAll(async ({ browser }) => {
    const { sharedUser } = loadFixtures();
    // Capture DEK bytes via exposeFunction before the hard page navigation
    // caused by router.replace("/") clears globalThis.
    savedSession = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });

    // Create the investment account using a fresh page that has the DEK injected.
    if (!investmentAccountCreated) {
      const ctx = await browser.newContext({ baseURL: "http://localhost:8081" });
      const page = await ctx.newPage();
      await restoreSession(page, savedSession);

      await page.goto("/accounts/");
      await expect(
        page
          .getByRole("heading", { name: "Accounts" })
          .or(page.getByRole("heading", { name: "Add your first account" })),
      ).toBeVisible({ timeout: 15_000 });

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
      investmentAccountCreated = true;

      await ctx.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    // Inject DEK + session cookie before any navigation so AuthProvider
    // initialises as "unlocked" on first render.
    await restoreSession(page, savedSession);
  });

  test("investment account was created in beforeAll", () => {
    // Guard: if beforeAll silently failed, every subsequent holdings test would
    // pass vacuously (no account → no add-holding dialog). This makes that failure loud.
    expect(investmentAccountCreated).toBe(true);
  });

  test("creates a holding via ticker and sees it in the table", async ({ page }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();

    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    // Type ticker — the combobox may trigger autocomplete
    const tickerInput = dialog.getByRole("combobox", { name: "Ticker" });
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
    await dialog.getByLabel("Shares").fill("10");
    await dialog.getByLabel("Avg cost per share").fill("150.00");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Holdings table should show AAPL (use table-scoped locator to avoid strict-mode
    // violations when prior runs left AAPL rows for the same user in the server DB)
    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable).toBeVisible({ timeout: 10_000 });
    await expect(holdingsTable.getByText("AAPL").first()).toBeVisible();
  });

  test("edits a holding's shares and cost basis", async ({ page }) => {
    await goToHoldings(page);

    // AAPL should be visible (created in previous test, same user+DB)
    await expect(
      page.getByRole("table", { name: "Holdings" }).getByText("AAPL").first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Edit AAPL" }).first().click();

    const dialog = page.getByRole("dialog", { name: /Edit holding/i });
    await expect(dialog).toBeVisible();

    const sharesInput = dialog.getByLabel("Shares");
    await sharesInput.clear();
    await sharesInput.fill("20");

    const costInput = dialog.getByLabel("Avg cost per share");
    await costInput.clear();
    await costInput.fill("160.00");

    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("table", { name: "Holdings" })).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Holdings" }).getByText("AAPL").first(),
    ).toBeVisible();
  });

  test("persists a holding with fractional shares (>2 decimal places)", async ({ page }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    const tickerInput = dialog.getByRole("combobox", { name: "Ticker" });
    await tickerInput.fill("MSFT");
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }

    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Shares").fill("1.234");
    await dialog.getByLabel("Avg cost per share").fill("400.00");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Regression: a sibling-field schema using Decimal.fromString at the
    // default scale of 2 silently rejected "1.234" on reload, dropping the
    // holding from the rendered list.
    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText("MSFT").first()).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(holdingsTable.getByText("MSFT").first()).toBeVisible({ timeout: 10_000 });
  });

  test("deleted holding stays deleted after a page reload", async ({ page }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    const ticker = `TST${RUN.slice(-4).toUpperCase()}`;
    await dialog.getByRole("combobox", { name: "Ticker" }).fill(ticker);
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Shares").fill("1");
    await dialog.getByLabel("Avg cost per share").fill("10.00");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText(ticker)).toBeVisible({ timeout: 10_000 });

    await page
      .getByRole("button", { name: `Delete ${ticker}` })
      .first()
      .click();
    const confirm = page.getByRole("dialog", { name: /Delete holding/i });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).not.toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Holdings", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // Regression: pull-without-version-guard used to clobber an unacked local
    // tombstone with the server's pre-delete copy on reload.
    if (await holdingsTable.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(holdingsTable.getByText(ticker)).not.toBeVisible({ timeout: 5_000 });
    }
  });

  test("creates a proxy holding with NAV anchor", async ({ page }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    // Use a fabricated ticker so this test never collides with a real-feed holding.
    const ticker = `PXY${RUN.slice(-4).toUpperCase()}`;
    await dialog.getByRole("combobox", { name: "Ticker" }).fill(ticker);
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }

    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Shares").fill("100");
    await dialog.getByLabel("Avg cost per share").fill("310.00");

    // Expand Advanced and set a proxy ticker. NAV input must appear and be required.
    await dialog.getByRole("button", { name: /advanced/i }).click();
    await dialog.getByLabel("Proxy ticker").fill("VOO");
    const navInput = dialog.getByLabel("Current price per share");
    await expect(navInput).toBeVisible();
    await navInput.fill("310.00");

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Regression: proxy holdings used to drop or zero-out on save when NAV wasn't
    // wired through scaleFactor.
    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText(ticker)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(holdingsTable.getByText(ticker)).toBeVisible({ timeout: 10_000 });
  });

  test("deletes a holding", async ({ page }) => {
    await goToHoldings(page);

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText("AAPL").first()).toBeVisible({ timeout: 10_000 });

    // Count AAPL rows before deletion (may be > 1 if prior runs left stale data)
    const aaplBefore = await holdingsTable.getByText("AAPL").count();

    await page.getByRole("button", { name: "Delete AAPL" }).first().click();

    const confirmDialog = page.getByRole("dialog", { name: /Delete holding/i });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete" }).click();

    // Verify the dialog closes (proves deletion was accepted) and the AAPL row count
    // dropped by one. The table may disappear entirely if all holdings are gone.
    await expect(confirmDialog).not.toBeVisible({ timeout: 10_000 });

    if (aaplBefore <= 1) {
      // Only one AAPL existed — table may disappear entirely after deletion.
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

  // ---------------------------------------------------------------------------
  // Pricing regression tests
  //
  // These guard against bugs caught during local testing that lint + unit
  // tests didn't surface:
  //   - newly added holdings rendered "-" until a full refetch (no warm-up)
  //   - deleting one row flashed every other row's price to "-" while the
  //     query refetched under a new key
  //   - crypto holdings were force-routed to Yahoo, so slugs never priced
  //   - navigating away from /holdings cleared the in-memory price cache
  //
  // Real upstream (Yahoo + CoinGecko) is in the loop, so timeouts are generous.
  // ---------------------------------------------------------------------------

  async function getMarketValueCell(
    page: import("@playwright/test").Page,
    ticker: string,
  ): Promise<ReturnType<import("@playwright/test").Page["locator"]>> {
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: `Edit ${ticker}` }) });
    return row.locator("td").nth(5);
  }

  async function addStockHolding(
    page: import("@playwright/test").Page,
    opts: { ticker: string; shares: string; avgCost: string },
  ): Promise<void> {
    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Ticker" }).fill(opts.ticker);
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Shares").fill(opts.shares);
    await dialog.getByLabel("Avg cost per share").fill(opts.avgCost);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  }

  test("newly added holding shows a market value within 60s (regression)", async ({ page }) => {
    await goToHoldings(page);
    await addStockHolding(page, { ticker: "GOOG", shares: "5", avgCost: "100.00" });

    // Regression: usePricesQuery rendered "-" for newly added rows until a full
    // refetch fired. warmPrice + the module-level cache now populate immediately.
    const cell = await getMarketValueCell(page, "GOOG");
    await expect(cell).toContainText("$", { timeout: 60_000 });
  });

  test("deleting one holding preserves other rows' prices (regression)", async ({ page }) => {
    await goToHoldings(page);

    // Ensure two priced holdings exist: GOOG (added in prior test) + NVDA here.
    await addStockHolding(page, { ticker: "NVDA", shares: "5", avgCost: "100.00" });

    const googCell = await getMarketValueCell(page, "GOOG");
    const nvdaCell = await getMarketValueCell(page, "NVDA");
    await expect(googCell).toContainText("$", { timeout: 60_000 });
    await expect(nvdaCell).toContainText("$", { timeout: 60_000 });

    // Regression: pre-cache implementation rebuilt the prices map on every
    // query-key change, briefly emptying every row's price column on delete.
    await page.getByRole("button", { name: "Delete NVDA" }).first().click();
    const confirm = page.getByRole("dialog", { name: /Delete holding/i });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).not.toBeVisible({ timeout: 10_000 });

    // GOOG's market value must still be a dollar amount — never a "-" flash.
    await expect(googCell).toContainText("$");
  });

  test("crypto asset type routes through CoinGecko (regression)", async ({ page }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    // Switch to Crypto, enter a slug (not an exchange ticker).
    await dialog.getByRole("radio", { name: "Crypto" }).click();
    await dialog.getByLabel("CoinGecko ID").fill("bitcoin");
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Shares").fill("0.1");
    await dialog.getByLabel("Avg cost per share").fill("50000.00");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Regression: every ticker used to be routed to Yahoo, so crypto slugs
    // returned "-" forever. The assetType-aware router now hits CoinGecko.
    const cell = await getMarketValueCell(page, "bitcoin");
    await expect(cell).toContainText("$", { timeout: 60_000 });
  });

  test("prices persist after navigating away and back (regression)", async ({ page }) => {
    await goToHoldings(page);

    const googCell = await getMarketValueCell(page, "GOOG");
    await expect(googCell).toContainText("$", { timeout: 60_000 });

    await page.getByRole("link", { name: "Dashboard" }).first().click();
    await expect(page).toHaveURL("/", { timeout: 10_000 });
    await page.getByRole("link", { name: "Holdings" }).first().click();
    await expect(page).toHaveURL("/holdings/", { timeout: 10_000 });

    // Regression: prior version mounted a fresh prices state per screen,
    // briefly rendering "-" before the refetch completed. Module-level cache
    // means the cell is populated on first paint.
    await expect(googCell).toContainText("$", { timeout: 5_000 });
  });

  test("Add holding with unpriceable proxy shows inline error and keeps drawer open", async ({
    page,
  }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    const tickerInput = dialog.getByRole("combobox", { name: "Ticker" });
    await tickerInput.fill("AAPL");
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }

    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Shares").fill("10");
    await dialog.getByLabel("Avg cost per share").fill("100.00");

    await dialog.getByRole("button", { name: /advanced/i }).click();
    await dialog.getByLabel("Proxy ticker").fill("PROXYBAD");
    await expect(dialog.getByLabel("Current price per share")).toBeVisible();
    await dialog.getByLabel("Current price per share").fill("123.45");

    await dialog.getByRole("button", { name: "Save holding" }).click();

    await expect(dialog.getByText(/couldn't get a current price for this proxy/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(dialog).toBeVisible();
  });

  test("Add holding form clears between opens", async ({ page }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();
    let dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Ticker" }).fill("WILLBEDISCARDED");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Add holding" }).first().click();
    dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Ticker" })).toHaveValue("");
  });
});
