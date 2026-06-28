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

let savedSession: SessionSnapshot;

async function goToAccounts(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app/accounts/");
  await expect(page).toHaveURL("/app/accounts/", { timeout: 15_000 });
  // Wait for the initial sync to fully drain before interacting. The sync pill
  // reads "synced" only once initialising flips false, which happens after
  // drainAllChanges() has populated the local store, so the empty<->populated
  // state is final and cannot flip mid-interaction. Firefox's slower pull
  // otherwise lets that flip race a form fill and wipe it.
  await expect(page.getByRole("status", { name: "Sync status: synced" })).toBeVisible({
    timeout: 20_000,
  });
  // Then confirm the screen has rendered its final state: the empty-state
  // heading ("Your vault is empty") or the populated sub-navigation.
  await expect(
    page
      .getByRole("heading", { name: /vault is empty/i })
      .or(page.getByRole("navigation", { name: "Invest sub-navigation" })),
  ).toBeVisible({ timeout: 15_000 });
}

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

    // The subnav "+ account" button or empty-state "+ Add account" button
    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Name").fill(`Cash-${RUN}`);
    // Kind defaults to investment; select Cash first so the "Current balance" field appears.
    await dialog.getByRole("radio", { name: "Cash" }).click();
    await dialog.getByLabel("Account type").selectOption("checking");
    await dialog.getByLabel("Current balance").fill("1234.56");
    await dialog.getByRole("button", { name: "Add account" }).click();

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

    await dialog.getByLabel("Name").fill(`Brokerage-${RUN}`);
    // Select investment kind (Radix radio segmented control)
    await dialog.getByRole("radio", { name: "Investment" }).click();
    await dialog.getByLabel("Account type").selectOption("brokerage");
    // Investment accounts show "Cash balance (optional)"
    await dialog.getByLabel("Cash balance (optional)").fill("5000.00");
    await dialog.getByRole("button", { name: "Add account" }).click();

    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    await expect(page.getByText(`Brokerage-${RUN}`)).toBeVisible({ timeout: SAVE_TIMEOUT });
  });

  test("edits an existing account name", async ({ page }) => {
    await goToAccounts(page);

    const existingName = `Cash-${RUN}`;
    const updatedName = `Checking-Updated-${RUN}`;

    // The cash account created in the first test should exist (same user, same DB).
    // Account rows are buttons with aria-label "<name>, <balance>".
    const tile = page.getByRole("button", { name: new RegExp(existingName) }).first();

    // If not present yet (re-run scenario), create it first.
    if ((await tile.count()) === 0) {
      await page
        .getByRole("button", { name: /Add.*account/i })
        .first()
        .click();
      const d = page.getByRole("dialog", { name: /Add account/i });
      await d.getByLabel("Name").fill(existingName);
      await d.getByRole("radio", { name: "Cash" }).click();
      await d.getByLabel("Account type").selectOption("checking");
      await d.getByLabel("Current balance").fill("100.00");
      await d.getByRole("button", { name: "Add account" }).click();
      await expect(d).not.toBeVisible({ timeout: SAVE_TIMEOUT });
      await expect(page.getByText(existingName).first()).toBeVisible({ timeout: SAVE_TIMEOUT });
    }

    // Click the account row to open the detail sheet
    await page
      .getByRole("button", { name: new RegExp(existingName) })
      .first()
      .click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    // Open edit form from the detail sheet; the sheet starts a 300ms exit animation
    // while the edit form opens, so wait for the edit dialog rather than sheet-gone.
    await sheet.getByRole("button", { name: "Edit account" }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit account" });
    await expect(editDialog).toBeVisible({ timeout: 5_000 });

    const nameInput = editDialog.getByLabel("Name");
    await nameInput.clear();
    await nameInput.fill(updatedName);
    await editDialog.getByRole("button", { name: "Save changes" }).click();

    await expect(editDialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
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
    await dialog.getByLabel("Name").fill("WILL_BE_DISCARDED");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Name")).toHaveValue("");
  });

  // Non-USD balance formatting is covered by the unit test in accounts.test.ts
  // ("formats a cash balance in the account's own currency"); the redesigned add
  // form no longer exposes a currency field, so it can't be exercised via E2E.

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
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("radio", { name: "Liability" }).click();
    // A negative stored balance is a credit balance (e.g. a card overpayment).
    // Liability balance label is "Amount owed"
    await dialog.getByLabel("Amount owed").fill("-5.00");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });

    // Regression: liabilities unconditionally prepended "-" after abs(), so a
    // credit balance rendered as "-$5.00" (a debt). It must read "$5.00".
    const tile = page.getByRole("button", { name: new RegExp(name) });
    await expect(tile).toContainText("$5", { timeout: SAVE_TIMEOUT });
    await expect(tile).not.toContainText("-$5");
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
    await d.getByLabel("Name").fill(deleteName);
    // Kind defaults to investment; select Cash so Current balance field appears.
    await d.getByRole("radio", { name: "Cash" }).click();
    await d.getByLabel("Account type").selectOption("checking");
    await d.getByLabel("Current balance").fill("0.00");
    await d.getByRole("button", { name: "Add account" }).click();
    await expect(d).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    await expect(page.getByText(deleteName)).toBeVisible({ timeout: SAVE_TIMEOUT });

    // Open the detail sheet and delete (two-tap: first click arms, second deletes)
    await page
      .getByRole("button", { name: new RegExp(deleteName) })
      .first()
      .click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // First tap: arms the delete
    await sheet.getByRole("button", { name: "Delete" }).click();
    // Second tap: confirms deletion ("Tap again to delete" label appears between taps)
    await expect(sheet.getByRole("button", { name: "Tap again to delete" })).toBeVisible({
      timeout: 3_000,
    });
    await sheet.getByRole("button", { name: "Tap again to delete" }).click();

    // Wait for the sheet to close (proves deletion was accepted)
    await expect(sheet).not.toBeVisible({ timeout: SAVE_TIMEOUT });

    await expect(page.getByText(deleteName)).not.toBeVisible({ timeout: SAVE_TIMEOUT });
  });
});
