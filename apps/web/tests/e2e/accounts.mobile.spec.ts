/**
 * Accounts CRUD on the mobile UI.
 *
 * Mirrors the desktop accounts flow but at a phone viewport, where the add
 * dialog is full-width and reached through the bottom-bar layout. Verifies the
 * user-observable outcome: a created account shows up in the list.
 *
 * Matches *.mobile.spec.ts, so it runs under the mobile projects (iPhone /
 * Pixel 5).
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
// Cold OPFS first write can run well past 10s; match the desktop spec's ceiling.
const SAVE_TIMEOUT = 30_000;

let savedSession: SessionSnapshot;

test.describe("accounts mobile", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const { sharedUser } = loadFixtures();
    savedSession = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);
  });

  test("creates a cash account and sees it in the list", async ({ page }) => {
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

    const name = `MobCash-${RUN}`;
    await dialog.getByLabel("Account name").fill(name);
    await dialog.getByLabel("Balance").fill("1234.56");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    await expect(page.getByText(name)).toBeVisible({ timeout: SAVE_TIMEOUT });
  });
});
