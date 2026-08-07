/**
 * Settings E2E: change master password.
 *
 * Runs under chromium (matches the chromium testMatch). The flow uses a fresh
 * per-run throwaway signup user so it does not mutate the shared fixture users
 * that other specs rely on (a password change would leave the fixture account
 * unusable for the rest of the serial run).
 */

import { expect, test } from "@playwright/test";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { loginAndCapture, restoreSession, signupAndLogin } from "./helpers/auth";

// Controlled inputs can be wiped between fill and submit; retry until the value
// actually sticks, mirroring fillLoginForm.
async function fillDialogField(
  dialog: import("@playwright/test").Locator,
  label: string,
  value: string,
): Promise<void> {
  await expect(async () => {
    const field = dialog.getByLabel(label);
    if ((await field.inputValue()) !== value) await field.fill(value);
    expect(await field.inputValue()).toBe(value);
  }).toPass({ timeout: 10_000 });
}

const RUN = Date.now().toString(36);
const PASS = "Privance-e2e-passphrase-2026!";
const NEW_PASS = "Privance-e2e-new-password-2026!";

async function openSettings(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app/settings/");
  await expect(page.getByRole("heading", { name: /The vault/ })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("settings - change password", () => {
  test("changing the password lets the user re-login with the new one", async ({ browser }) => {
    test.setTimeout(180_000);

    const username = `carol-${RUN}`;
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();

    // Sign up a throwaway user and restore the authenticated + unlocked session.
    const { session } = await signupAndLogin(browser, { username, password: PASS });
    // restoreSession only injects the DEK + session cookie. The auth context
    // reads the username from localStorage ("privance.username"), which it would
    // normally set during login(). Seed it so the dialogs receive a defined
    // username prop and can arm/submit; otherwise both stay inert.
    await page.addInitScript((u: string) => {
      localStorage.setItem("privance.username", u);
    }, username);
    await restoreSession(page, session);
    await openSettings(page);

    // Open the change-password dialog from its settings row.
    await page.getByRole("button", { name: "Master password" }).click();
    const dialog = page.getByRole("dialog", { name: /Change master password/i });
    await expect(dialog).toBeVisible();

    await fillDialogField(dialog, "Current password", PASS);
    await fillDialogField(dialog, "New password", NEW_PASS);
    await dialog.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Save your new phrase" })).toBeVisible({
      timeout: 45_000,
    });
    await page.getByRole("button", { name: "I saved the new phrase" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await ctx.close();

    // Verify the new password authorises a fresh login that reaches the app.
    const newSession: SessionSnapshot = await loginAndCapture(browser, {
      username,
      password: NEW_PASS,
    });
    const verifyCtx = await browser.newContext({ baseURL: BASE_URL });
    const verifyPage = await verifyCtx.newPage();
    await restoreSession(verifyPage, newSession);
    await verifyPage.goto("/app/");
    await expect(verifyPage).toHaveURL("/app/", { timeout: 15_000 });
    await expect(verifyPage.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });

    // And the old password is no longer accepted.
    const homeCtx = await browser.newContext({ baseURL: BASE_URL });
    const homePage = await homeCtx.newPage();
    await homePage.goto("/auth/login/");
    await homePage.getByLabel("Username").fill(username);
    await homePage.getByLabel("Master password").fill(PASS);
    await homePage.getByRole("button", { name: "Sign in" }).click();
    await expect(homePage.getByText(/Wrong password/i)).toBeVisible({ timeout: 30_000 });

    await verifyCtx.close();
    await homeCtx.close();
  });
});
