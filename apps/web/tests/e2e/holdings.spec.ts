import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
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
  await page.goto("/app/holdings/");
  await expect(page).toHaveURL("/app/holdings/", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Holdings", exact: true })).toBeVisible({
    timeout: 10_000,
  });
  // Let the initial sync drain and async prices settle before interacting, so a
  // late re-render can't land mid-fill and revert a controlled input.
  await page.waitForLoadState("networkidle");
}

// ---------------------------------------------------------------------------
// Holdings CRUD
// ---------------------------------------------------------------------------

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

  test("creates a holding via ticker and sees it in the table", async ({ page }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();

    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    // Type ticker — the combobox may trigger autocomplete
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
    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText("AAPL").first()).toBeVisible();

    // The edit must actually persist: 20 shares * fake AAPL $180 = $3,600.00
    // market value. (Previously this test only checked the row was still
    // visible, so a silently-discarded edit would have passed.)
    const editedRow = holdingsTable
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: "Edit AAPL" }) })
      .first();
    await expect(editedRow.locator("td").nth(2)).toHaveText("20", { timeout: 15_000 });
    await expect(editedRow.locator("td").nth(5)).toContainText("$3,600", { timeout: 15_000 });
  });

  test("persists a holding with fractional shares (>2 decimal places)", async ({ page }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    const tickerInput = dialog.getByLabel("Ticker");
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
    await dialog.getByLabel("Ticker").fill(ticker);
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
    await dialog.getByLabel("Ticker").fill(ticker);
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
    await dialog.getByLabel("Ticker").fill(opts.ticker);
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
    await expect(page).toHaveURL("/app/", { timeout: 10_000 });
    await page.getByRole("link", { name: "Holdings" }).first().click();
    await expect(page).toHaveURL("/app/holdings/", { timeout: 10_000 });

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

    const tickerInput = dialog.getByLabel("Ticker");
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
    await dialog.getByLabel("Ticker").fill("WILLBEDISCARDED");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Add holding" }).first().click();
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
    await page.getByRole("button", { name: "Add holding" }).first().click();
    const addDialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(addDialog).toBeVisible();

    await addDialog.getByLabel("Ticker").fill(ticker);
    const listbox = addDialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await addDialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await addDialog.getByLabel("Shares").fill("10");
    await addDialog.getByLabel("Avg cost per share").fill("200.00");

    await addDialog.getByRole("button", { name: /advanced/i }).click();
    await addDialog.getByLabel("Proxy ticker").fill("VOO");
    const navInput = addDialog.getByLabel("Current price per share");
    await expect(navInput).toBeVisible();
    await navInput.fill("200.00");

    await addDialog.getByRole("button", { name: "Save" }).click();
    await expect(addDialog).not.toBeVisible({ timeout: 15_000 });

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    await expect(holdingsTable.getByText(ticker).first()).toBeVisible({ timeout: 10_000 });

    // Scope to this run's account so a PRVT row left in another account by a
    // prior run (sharedUser persists across runs) can't be matched instead.
    const row = holdingsTable
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: `Edit ${ticker}` }) })
      .filter({ hasText: INVESTMENT_ACCOUNT_NAME });
    const valueCell = row.locator("td").nth(5);

    // Confirm proxied market value: 10 * VOO(500) * 0.4 = $2,000.
    await expect(valueCell).toContainText("$2,000", { timeout: 15_000 });

    // Edit: clear the Proxy ticker field, save.
    await row.getByRole("button", { name: `Edit ${ticker}` }).click();
    const editDialog = page.getByRole("dialog", { name: /Edit holding/i });
    await expect(editDialog).toBeVisible();

    const proxyInput = editDialog.getByLabel("Proxy ticker");
    await expect(proxyInput).toBeVisible();
    await proxyInput.clear();

    await editDialog.getByRole("button", { name: "Save" }).click();
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });

    // After un-anchoring: 10 * PRVT(300) = $3,000.
    // Without the fix (stale scaleFactor=0.4 left in payload): 10 * 300 * 0.4 = $1,200.
    await expect(valueCell).toContainText("$3,000", { timeout: 15_000 });
  });

  test("a proxy ticker with a blank current price surfaces an inline error inside the drawer (regression)", async ({
    page,
  }) => {
    await goToHoldings(page);

    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();

    const ticker = `NAV${RUN.slice(-4).toUpperCase()}`;
    await dialog.getByLabel("Ticker").fill(ticker);
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await dialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await dialog.getByLabel("Shares").fill("10");
    await dialog.getByLabel("Avg cost per share").fill("100.00");

    // Set a proxy but leave "Current price per share" blank, then save.
    await dialog.getByRole("button", { name: /advanced/i }).click();
    await dialog.getByLabel("Proxy ticker").fill("VOO");
    await dialog.getByRole("button", { name: "Save holding" }).click();

    // Regression: the missing-NAV error used to throw to a banner rendered in
    // the page behind the open dialog, invisible to the user. It now surfaces
    // inline next to the NAV field and the drawer stays open.
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

    await page.getByRole("button", { name: "Add holding" }).first().click();
    const addDialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("Ticker").fill(ticker);
    const listbox = addDialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await addDialog.getByLabel("Account").selectOption({ label: INVESTMENT_ACCOUNT_NAME });
    await addDialog.getByLabel("Shares").fill("4");
    await addDialog.getByLabel("Avg cost per share").fill("250.00");
    await addDialog.getByRole("button", { name: /advanced/i }).click();
    await addDialog.getByLabel("Proxy ticker").fill("VOO");
    const navInput = addDialog.getByLabel("Current price per share");
    await expect(navInput).toBeVisible();
    await navInput.fill("250.00");
    await addDialog.getByRole("button", { name: "Save" }).click();
    await expect(addDialog).not.toBeVisible({ timeout: 15_000 });

    const holdingsTable = page.getByRole("table", { name: "Holdings" });
    const row = holdingsTable
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name: `Edit ${ticker}` }) })
      .filter({ hasText: INVESTMENT_ACCOUNT_NAME });
    const valueCell = row.locator("td").nth(5);
    await expect(valueCell).toContainText("$1,000", { timeout: 15_000 });

    // Edit shares only; the (blank) NAV field is left untouched.
    await row.getByRole("button", { name: `Edit ${ticker}` }).click();
    const editDialog = page.getByRole("dialog", { name: /Edit holding/i });
    await expect(editDialog).toBeVisible();
    const sharesInput = editDialog.getByLabel("Shares");
    await sharesInput.clear();
    await sharesInput.fill("8");
    await editDialog.getByRole("button", { name: "Save" }).click();

    // Regression: a NAV-required-whenever-proxy-set guard wrongly blocked this
    // save. The unchanged anchor must be reused so the value rescales cleanly.
    await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
    await expect(valueCell).toContainText("$2,000", { timeout: 15_000 });
  });

  test("sorts by account name, not account id (regression)", async ({ page }) => {
    // A second account whose name sorts before the brokerage makes a name-based
    // sort observable; a UUID-based sort would order the rows arbitrarily.
    const secondAccount = `AAA-Sort-${RUN}`;
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
    const acctDialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(acctDialog).toBeVisible();
    await acctDialog.getByLabel("Account name").fill(secondAccount);
    await acctDialog.getByRole("button", { name: "Investment" }).click();
    await acctDialog.getByLabel("Balance").fill("0.00");
    await acctDialog.getByRole("button", { name: "Save" }).click();
    await expect(acctDialog).not.toBeVisible({ timeout: 10_000 });

    await goToHoldings(page);

    // Add one holding to the second account so at least two accounts have rows.
    await page.getByRole("button", { name: "Add holding" }).first().click();
    const dialog = page.getByRole("dialog", { name: /Add holding/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Ticker").fill("VOO");
    const listbox = dialog.locator('[role="listbox"]');
    if (await listbox.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await page.keyboard.press("Escape");
    }
    await dialog.getByLabel("Account").selectOption({ label: secondAccount });
    await dialog.getByLabel("Shares").fill("1");
    await dialog.getByLabel("Avg cost per share").fill("100.00");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });

    // Sort by the Account column and read the account cell of every row.
    await page.getByRole("button", { name: "Sort by Account" }).click();
    const accountCells = page
      .getByRole("table", { name: "Holdings" })
      .locator("tbody tr td:nth-child(2)");
    await expect(accountCells.first()).toBeVisible({ timeout: 10_000 });

    const names = (await accountCells.allInnerTexts()).map((s) => s.trim());
    const ascending = [...names].sort((a, b) => a.localeCompare(b));
    const descending = [...ascending].reverse();
    // At least two distinct account names must be present for the order to mean
    // anything, and the visible order must be monotonic by NAME (asc or desc) --
    // which a UUID-keyed sort would not produce.
    expect(new Set(names).size).toBeGreaterThanOrEqual(2);
    expect([JSON.stringify(ascending), JSON.stringify(descending)]).toContain(
      JSON.stringify(names),
    );
  });
});
