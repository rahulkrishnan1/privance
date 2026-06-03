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

// Unique suffix so account names don't clash if tests are re-run while DB is live
const RUN = Date.now().toString(36);

// Each test reloads the page, so its first encrypted write hits a cold OPFS
// store. In dev mode that round-trip can run well past 10s (the suite's very
// first write, before the SAH pool is warm, has been seen near 26s). Give every
// post-save assertion a generous ceiling so the cold-write latency does not read
// as a failure; warm writes still resolve in ~1.5s.
const SAVE_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Session state shared across all tests in this file.
// Login once in beforeAll (capturing DEK via exposeFunction before hard nav),
// then inject DEK + cookies in beforeEach so we only burn one login attempt
// against the per-username rate limit (5/min).
// ---------------------------------------------------------------------------

let savedSession: SessionSnapshot;

// ---------------------------------------------------------------------------
// Helper: navigate to Accounts page (requires beforeEach to have set up auth)
// ---------------------------------------------------------------------------

async function goToAccounts(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app/accounts/");
  // Wait for the accounts screen to fully render (empty state or list)
  await expect(
    page
      .getByRole("heading", { name: "Accounts" })
      .or(page.getByRole("heading", { name: "Add your first account" })),
  ).toBeVisible({ timeout: 15_000 });
  // Let the initial sync drain and the async prices query settle before any
  // form interaction. Otherwise a late re-render (prices resolving) can land
  // mid-fill and revert the controlled input, surfacing as a lost field value.
  await page.waitForLoadState("networkidle");
}

// ---------------------------------------------------------------------------
// Accounts CRUD
// ---------------------------------------------------------------------------

test.describe("accounts", () => {
  test.beforeAll(async ({ browser }) => {
    const { sharedUser } = loadFixtures();
    // Capture DEK bytes via exposeFunction before the hard page navigation
    // caused by router.replace("/app/") clears globalThis.
    savedSession = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });
  });

  test.beforeEach(async ({ page }) => {
    // Inject DEK + session cookie before any navigation so AuthProvider
    // initialises as "unlocked" on first render.
    await restoreSession(page, savedSession);
  });

  test("creates a cash account and sees it in the list", async ({ page }) => {
    await goToAccounts(page);

    // Works regardless of empty state or list state
    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Account name").fill(`Cash-${RUN}`);
    // Kind defaults to "cash"
    await dialog.getByLabel("Balance").fill("1234.56");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    await expect(page.getByText(`Cash-${RUN}`)).toBeVisible({ timeout: SAVE_TIMEOUT });
  });

  test("creates an investment account and sees it in the list", async ({ page }) => {
    await goToAccounts(page);

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Account name").fill(`Brokerage-${RUN}`);
    await dialog.getByRole("button", { name: "Investment" }).click();
    await dialog.getByLabel("Balance").fill("5000.00");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    // Verify the account appears in the list — the Investment section header is
    // not checked directly because "Investment" also appears as a button label
    // inside the (now-closed but still-in-DOM) dialog, which would cause a
    // strict-mode locator violation. Verifying the account name is sufficient.
    await expect(page.getByText(`Brokerage-${RUN}`)).toBeVisible({ timeout: SAVE_TIMEOUT });
  });

  test("edits an existing account name", async ({ page }) => {
    await goToAccounts(page);

    // First ensure the target account exists
    const existingName = `Cash-${RUN}`;
    const updatedName = `Checking-Updated-${RUN}`;

    // The cash account created in the first test should exist (same user, same DB)
    const tile = page.getByRole("button", { name: new RegExp(existingName) }).first();

    // If not present yet (re-run scenario), create it first. The form
    // requires a type, so this mirrors the canonical create-cash test.
    if ((await tile.count()) === 0) {
      await page
        .getByRole("button", { name: /Add.*account/i })
        .first()
        .click();
      const d = page.getByRole("dialog", { name: /Add account/i });
      await d.getByLabel("Account name").fill(existingName);
      await d.getByRole("button", { name: "Cash" }).click();
      await d.getByLabel("Balance").fill("100.00");
      await d.getByRole("button", { name: "Save" }).click();
      await expect(d).not.toBeVisible({ timeout: SAVE_TIMEOUT });
      await expect(page.getByText(existingName).first()).toBeVisible({ timeout: SAVE_TIMEOUT });
    }

    // Open tile menu
    await page
      .getByRole("button", { name: new RegExp(existingName) })
      .first()
      .click();
    await page.getByRole("menuitem", { name: new RegExp(`Edit ${existingName}`) }).click();

    const dialog = page.getByRole("dialog", { name: /Edit account/i });
    await expect(dialog).toBeVisible();

    const nameInput = dialog.getByLabel("Account name");
    await nameInput.clear();
    await nameInput.fill(updatedName);
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: SAVE_TIMEOUT });
  });

  test("Add account form clears between opens", async ({ page }) => {
    await goToAccounts(page);

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    let dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Account name").fill("WILL_BE_DISCARDED");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Account name")).toHaveValue("");
  });

  test("displays a non-USD account balance with its own currency symbol (regression)", async ({
    page,
  }) => {
    await goToAccounts(page);

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();

    const name = `Euro-${RUN}`;
    await dialog.getByLabel("Account name").fill(name);
    const currency = dialog.getByLabel("Currency (ISO 4217)");
    await currency.clear();
    await currency.fill("EUR");
    await dialog.getByLabel("Balance").fill("1500.00");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });

    // Regression: formatBalance ignored account.payload.currency and always
    // rendered a "$", so a EUR account showed $1,500.00 instead of €1,500.00.
    const tile = page.getByRole("button", { name: new RegExp(name) });
    await expect(tile).toContainText("€1,500.00", { timeout: SAVE_TIMEOUT });
    await expect(tile).not.toContainText("$1,500.00");
  });

  test("liability with a credit (negative) balance renders without a double negative (regression)", async ({
    page,
  }) => {
    await goToAccounts(page);

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();

    const name = `Credit-${RUN}`;
    await dialog.getByLabel("Account name").fill(name);
    await dialog.getByRole("button", { name: "Liability" }).click();
    // A negative stored balance is a credit balance (e.g. a card overpayment).
    await dialog.getByLabel("Balance").fill("-5.00");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });

    // Regression: liabilities unconditionally prepended "-" after abs(), so a
    // credit balance rendered as "-$5.00" (a debt). It must read "$5.00".
    const tile = page.getByRole("button", { name: new RegExp(name) });
    await expect(tile).toContainText("$5.00", { timeout: SAVE_TIMEOUT });
    await expect(tile).not.toContainText("-$5.00");
  });

  test("deletes an account and it disappears from the list", async ({ page }) => {
    await goToAccounts(page);

    const deleteName = `Delete-${RUN}`;
    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    const d = page.getByRole("dialog", { name: /Add account/i });
    await expect(d).toBeVisible();
    await d.getByLabel("Account name").fill(deleteName);
    await d.getByLabel("Balance").fill("0.00");
    await d.getByRole("button", { name: "Save" }).click();
    await expect(d).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    await expect(page.getByText(deleteName)).toBeVisible({ timeout: SAVE_TIMEOUT });

    await page
      .getByRole("button", { name: new RegExp(deleteName) })
      .first()
      .click();
    await page.getByRole("menuitem", { name: new RegExp(`Delete ${deleteName}`) }).click();
    const confirmDialog = page.getByRole("dialog", { name: /Delete account/i });
    await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();
    // Wait for the confirm dialog to close before asserting the tile is gone;
    // the dialog body still contains the name until then, which would cause a
    // strict-mode violation on getByText.
    await expect(confirmDialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });

    await expect(page.getByText(deleteName)).not.toBeVisible({ timeout: SAVE_TIMEOUT });
  });
});
