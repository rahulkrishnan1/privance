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
  await expect(page).toHaveURL("/app/holdings/", { timeout: 10_000 });
  // Wait until the invest screen has finished loading: either the holdings table
  // (populated) or the empty-state heading. The OPFS store resolves locally, so
  // networkidle fires too early. (Match the empty-state heading, not an "Add
  // holding" button, since both the subnav and the empty state expose one.)
  await expect(
    page
      .getByRole("table", { name: "Holdings" })
      .or(page.getByRole("heading", { name: /Track your portfolio/i })),
  ).toBeVisible({ timeout: 15_000 });
  // Wait for the initial sync to fully drain so the empty<->populated state is
  // final and cannot flip mid-interaction (see waitForSynced).
  await waitForSynced(page);
}

async function openAddHoldingDialog(page: import("@playwright/test").Page): Promise<void> {
  // Match both the subnav "+ holding" button and the empty-state "Add holding" button.
  await page
    .getByRole("button", { name: /Add holding|\+ holding/i })
    .first()
    .click();
}

test.describe("holdings", () => {
  test.beforeAll(async ({ browser }) => {
    const { sharedUser } = loadFixtures();
    // Capture DEK bytes via exposeFunction before the hard page navigation
    // caused by router.replace("/app/") clears globalThis.
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
      await expect(page).toHaveURL("/app/accounts/", { timeout: 15_000 });
      // Wait for invest screen to finish loading (OPFS is local, networkidle fires too early).
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
      // First write hits a cold OPFS store; the dev-mode round-trip can exceed
      // 10s before the SAH pool is warm.
      await expect(dialog).not.toBeVisible({ timeout: 30_000 });
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

  test("filtering by account updates the holdings panel heading (regression)", async ({ page }) => {
    await goToHoldings(page);

    // The card heading doubles as the scope-menu trigger; open it, then pick the account.
    const scopeTrigger = page.getByRole("button", { name: /All holdings/ });
    await expect(scopeTrigger).toBeVisible({ timeout: 10_000 });

    await scopeTrigger.click();
    await page
      .getByRole("dialog", { name: /Filter holdings by scope/i })
      .getByRole("option", { name: new RegExp(INVESTMENT_ACCOUNT_NAME) })
      .click();

    await expect(
      page.getByRole("heading", { name: new RegExp(INVESTMENT_ACCOUNT_NAME) }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: /All holdings/ })).not.toBeVisible();
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

    // Holdings table should show AAPL (use table-scoped locator to avoid strict-mode
    // violations when prior runs left AAPL rows for the same user in the server DB)
    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable).toBeVisible({ timeout: 10_000 });
    await expect(holdingsTable.getByText("AAPL").first()).toBeVisible();
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
    // Sheet has a 300ms exit animation; wait for the edit dialog by name instead.
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

  test("persists a holding with fractional shares (>2 decimal places)", async ({ page }) => {
    await goToHoldings(page);

    await openAddHoldingDialog(page);
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    const tickerInput = dialog.getByLabel("Ticker");
    await tickerInput.fill("MSFT");
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }

    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Quantity").fill("1.234");
    await dialog.getByLabel("Avg cost basis").fill("400.00");
    await dialog.getByRole("button", { name: "Add holding" }).click();

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
    const tableVisible = await page
      .getByRole("table", { name: "Holdings" })
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (tableVisible) {
      await expect(page.getByRole("table", { name: "Holdings" }).getByText(ticker)).not.toBeVisible(
        { timeout: 5_000 },
      );
    }
  });

  test("creates a proxy holding with NAV anchor", async ({ page }) => {
    await goToHoldings(page);

    await openAddHoldingDialog(page);
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    // Use a fabricated ticker so this test never collides with a real-feed holding.
    const ticker = `PXY${RUN.slice(-4).toUpperCase()}`;
    await dialog.getByLabel("Ticker").fill(ticker);
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }

    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Quantity").fill("100");
    await dialog.getByLabel("Avg cost basis").fill("310.00");

    // Expand Advanced and set a proxy ticker. NAV input must appear and be required.
    await dialog.getByRole("button", { name: /advanced/i }).click();
    await dialog.getByLabel("Proxy ticker").fill("VOO");
    const navInput = dialog.getByLabel("Current price per share");
    await expect(navInput).toBeVisible();
    await navInput.fill("310.00");

    await dialog.getByRole("button", { name: "Add holding" }).click();
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
    // projects), so an unscoped lookup would be ambiguous.
    const row = page.getByRole("button", { name: new RegExp(`${ticker}.*open holding details`) });
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

  test("prices persist after navigating away and back (regression)", async ({ page }) => {
    await goToHoldings(page);

    const googCell = await getMarketValueCell(page, "GOOG");
    await expect(googCell).toContainText("$", { timeout: 60_000 });

    // Navigate to Overview then back to Holdings via the subnav links
    await page.getByRole("link", { name: "Overview" }).first().click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    await page.getByRole("link", { name: "Holdings" }).first().click();
    await expect(page).toHaveURL("/app/holdings/", { timeout: 10_000 });

    // Regression: prior version mounted a fresh prices state per screen,
    // briefly rendering "-" before the refetch completed. Module-level cache
    // means the cell is populated on first paint.
    await expect(googCell).toContainText("$", { timeout: 5_000 });
  });

  test("Add holding with unpriceable proxy shows inline error and keeps dialog open", async ({
    page,
  }) => {
    await goToHoldings(page);

    await openAddHoldingDialog(page);
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    const tickerInput = dialog.getByLabel("Ticker");
    await tickerInput.fill("AAPL");
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }

    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Quantity").fill("10");
    await dialog.getByLabel("Avg cost basis").fill("100.00");

    await dialog.getByRole("button", { name: /advanced/i }).click();
    await dialog.getByLabel("Proxy ticker").fill("PROXYBAD");
    await expect(dialog.getByLabel("Current price per share")).toBeVisible();
    await dialog.getByLabel("Current price per share").fill("123.45");

    await dialog.getByRole("button", { name: "Add holding" }).click();

    await expect(dialog.getByText(/couldn't get a current price for this proxy/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(dialog).toBeVisible();
  });

  test("Add holding form clears between opens", async ({ page }) => {
    await goToHoldings(page);

    await openAddHoldingDialog(page);
    let dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Ticker").fill("WILLBEDISCARDED");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    await openAddHoldingDialog(page);
    dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Ticker")).toHaveValue("");
  });

  test("removing a holding's proxy ticker reprices at the real ticker, not the stale scale factor (regression)", async ({
    page,
  }) => {
    // Realistic scenario: a formerly-restricted holding (PRVT, no public quote)
    // anchored to VOO while illiquid, then listed and directly priceable, so the
    // user removes the proxy. Fake prices: PRVT=$300, VOO=$500.
    // 10 shares, NAV=$200 while anchored -> scaleFactor = 200/500 = 0.4.
    //   anchored market value = 10 * 500 * 0.4 = $2,000
    //   after un-anchoring    = 10 * 300       = $3,000
    // The stale-scale bug produced $1,200 (10 * 300 * 0.4) instead of $3,000.
    const ticker = "PRVT";

    await goToHoldings(page);

    // Add PRVT with proxyTicker=VOO and NAV="200.00".
    await openAddHoldingDialog(page);
    const addDialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(addDialog).toBeVisible();

    await addDialog.getByLabel("Ticker").fill(ticker);
    const listbox = addDialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await addDialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await addDialog.getByLabel("Quantity").fill("10");
    await addDialog.getByLabel("Avg cost basis").fill("200.00");

    await addDialog.getByRole("button", { name: /advanced/i }).click();
    // Wait for the advanced section to finish revealing before filling: on
    // firefox a fill into the just-expanded section can be dropped as the
    // collapsible renders, leaving proxyTicker empty (holding then saves
    // unanchored). Assert each value stuck before saving.
    // Type real keystrokes (not fill): on firefox a fill into the freshly
    // expanded section sets the DOM value but the change can miss react-hook-
    // form, leaving proxyTicker empty so the holding saves unanchored.
    const addProxyInput = addDialog.getByLabel("Proxy ticker");
    await expect(addProxyInput).toBeVisible();
    await addProxyInput.click();
    await addProxyInput.pressSequentially("VOO");
    const navInput = addDialog.getByLabel("Current price per share");
    await expect(navInput).toBeVisible();
    await navInput.click();
    await navInput.pressSequentially("200.00");
    // Blur so react-hook-form commits both fields before save. On firefox/webkit
    // the keystrokes set the DOM value but the RHF state can lag, so the holding
    // would save unanchored without an explicit commit.
    await navInput.press("Tab");
    await expect(addProxyInput).toHaveValue("VOO");
    await expect(navInput).toHaveValue("200.00");

    await addDialog.getByRole("button", { name: "Add holding" }).click();
    await expect(addDialog).not.toBeVisible({ timeout: 15_000 });

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText(ticker).first()).toBeVisible({ timeout: 10_000 });

    // Get the row for PRVT in this run's account. The row has aria-label
    // "PRVT, open holding details". Use the Value cell to verify the proxied price.
    // Scope further by filtering for the account name in the detail sheet later.
    const prvtRows = page.getByRole("button", { name: /PRVT.*open holding details/ });

    // The anchored value cell should show $2,000.
    const valueCell = prvtRows.first().getByTestId("holding-value");
    await expect(valueCell).toContainText("$2,000", { timeout: 15_000 });

    // Open detail sheet and edit to clear the proxy ticker
    await prvtRows.first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Edit holding" }).click();
    // Sheet has a 300ms exit animation; wait for the edit dialog by name instead.
    const editDialog = page.getByRole("dialog", { name: /Edit holding/i });
    await expect(editDialog).toBeVisible({ timeout: 5_000 });

    const proxyInput = editDialog.getByLabel("Proxy ticker");
    await expect(proxyInput).toBeVisible();
    await proxyInput.clear();

    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });

    // After un-anchoring: 10 * PRVT(300) = $3,000.
    // Without the fix (stale scaleFactor=0.4 left in payload): 10 * 300 * 0.4 = $1,200.
    await expect(valueCell).toContainText("$3,000", { timeout: 15_000 });

    // Clean up: PRVT is a fixed fixture ticker (not RUN-scoped), so a leftover
    // row would shadow this same test's `prvtRows.first()` in the next project
    // (projects share the user and the DB persists between them).
    await prvtRows.first().click();
    const cleanupSheet = page.getByRole("dialog");
    await expect(cleanupSheet).toBeVisible();
    await cleanupSheet.getByRole("button", { name: "Delete" }).click();
    await expect(cleanupSheet.getByRole("button", { name: "Tap again to delete" })).toBeVisible({
      timeout: 3_000,
    });
    await cleanupSheet.getByRole("button", { name: "Tap again to delete" }).click();
    await expect(cleanupSheet).not.toBeVisible({ timeout: 10_000 });
  });

  test("a proxy ticker with a blank current price surfaces an inline error inside the dialog (regression)", async ({
    page,
  }) => {
    await goToHoldings(page);

    await openAddHoldingDialog(page);
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    const ticker = `NAV${RUN.slice(-4).toUpperCase()}`;
    await dialog.getByLabel("Ticker").fill(ticker);
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Quantity").fill("10");
    await dialog.getByLabel("Avg cost basis").fill("100.00");

    // Set a proxy but leave "Current price per share" blank, then save.
    await dialog.getByRole("button", { name: /advanced/i }).click();
    await dialog.getByLabel("Proxy ticker").fill("VOO");
    await dialog.getByRole("button", { name: "Add holding" }).click();

    // Regression: the missing-NAV error used to throw to a banner rendered in
    // the page behind the open dialog, invisible to the user. It now surfaces
    // inline next to the NAV field and the dialog stays open.
    await expect(
      dialog.getByText("Enter the current price per share for the proxy ticker."),
    ).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toBeVisible();
  });

  test("editing an anchored holding without re-entering NAV keeps the proxy anchor (regression)", async ({
    page,
  }) => {
    // Anchor to VOO at NAV=250 -> scaleFactor 250/500 = 0.5.
    //   4 shares -> 4 * 500 * 0.5 = $1,000
    //   8 shares -> 8 * 500 * 0.5 = $2,000  (anchor reused; NAV left blank on edit)
    const ticker = `ANCH${RUN.slice(-4).toUpperCase()}`;
    await goToHoldings(page);

    await openAddHoldingDialog(page);
    const addDialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("Ticker").fill(ticker);
    const listbox = addDialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await addDialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await addDialog.getByLabel("Quantity").fill("4");
    await addDialog.getByLabel("Avg cost basis").fill("250.00");
    await addDialog.getByRole("button", { name: /advanced/i }).click();
    await addDialog.getByLabel("Proxy ticker").fill("VOO");
    const navInput = addDialog.getByLabel("Current price per share");
    await expect(navInput).toBeVisible();
    await navInput.fill("250.00");
    await addDialog.getByRole("button", { name: "Add holding" }).click();
    await expect(addDialog).not.toBeVisible({ timeout: 15_000 });

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText(ticker).first()).toBeVisible({ timeout: 10_000 });

    const anchRow = page.getByRole("button", {
      name: new RegExp(`${ticker}.*open holding details`),
    });
    const valueCell = anchRow.first().getByTestId("holding-value");
    await expect(valueCell).toContainText("$1,000", { timeout: 15_000 });

    // Open detail sheet, then edit shares only; the (blank) NAV field is left untouched.
    await anchRow.first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Edit holding" }).click();
    // Sheet has a 300ms exit animation; wait for the edit dialog by name instead.
    const editDialog = page.getByRole("dialog", { name: /Edit holding/i });
    await expect(editDialog).toBeVisible({ timeout: 5_000 });
    const sharesInput = editDialog.getByLabel("Quantity");
    await sharesInput.clear();
    await sharesInput.fill("8");
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    // Regression: a NAV-required-whenever-proxy-set guard wrongly blocked this
    // save. The unchanged anchor must be reused so the value rescales cleanly.
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    await expect(valueCell).toContainText("$2,000", { timeout: 15_000 });
  });
});
