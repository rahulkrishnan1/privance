/**
 * Biometric PRF E2E (AE2/AE7 + locked-screen sign-out) via the CDP virtual
 * WebAuthn authenticator.
 *
 * Chromium-only by construction: this file matches the chromium testMatch and
 * is the E2E home for the CDP-PRF journeys (installVirtualAuthenticator throws
 * on non-Chromium engines). AE1 (no biometric UI on non-PRF browsers) lives in
 * biometric-unlock.spec.ts, which runs under webkit.
 *
 * Provisioning: uses the bioUser fixture from global-setup.ts. Biometric state
 * is browser-context-local (fresh per test) and the server stores nothing
 * biometric, so sharing the single fixture user across scenarios is safe.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import {
  installVirtualAuthenticator,
  readIdbEnrollment,
  removeVirtualAuthenticator,
} from "./helpers/webauthn";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

// Two Argon2id derivations (login + possible unlock) dominate wall-clock.
test.setTimeout(90_000);

async function inlineLogin(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/auth/login/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Master password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Argon2id is intentionally heavy; under the biometric suite's back-to-back
  // logins the browser KDF can spike well past a few seconds, so allow headroom.
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 45_000 });
  await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 10_000 });
}

// Lock via the top nav button (aria-label="Lock"). .first() avoids strict-mode
// violations when the settings page shows two Lock buttons.
async function lockViaNav(page: import("@playwright/test").Page): Promise<void> {
  await page.getByLabel("Lock").first().click();
  await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Master password|Welcome back/ })).toBeVisible({
    timeout: 10_000,
  });
}

// Open the Biometric unlock dialog from its settings row.
async function openBiometricDialog(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app/settings/");
  await expect(page.getByRole("heading", { name: /The vault/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Biometric unlock/ }).click();
}

// Close the Biometric unlock dialog; a still-open modal intercepts pointer events.
async function closeBiometricDialog(page: import("@playwright/test").Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Biometric unlock" })).not.toBeVisible({
    timeout: 5_000,
  });
}

// Enroll from the settings page, closing the dialog at the end.
async function enrollBiometric(page: import("@playwright/test").Page): Promise<void> {
  await openBiometricDialog(page);
  await page.getByRole("button", { name: "Enable biometric unlock" }).click();
  await expect(page.getByRole("button", { name: "Disable biometric unlock" })).toBeVisible({
    timeout: 15_000,
  });
  await closeBiometricDialog(page);
}

test.describe("biometric PRF (CDP)", () => {
  test("enroll → lock → PRF unlock → disable purges", async ({ page }) => {
    test.setTimeout(180_000);
    const { bioUser } = loadFixtures();
    const authId = await installVirtualAuthenticator(page);

    try {
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);

      // Lock via nav (not logout): enrollment must survive the lock.
      await lockViaNav(page);

      // PRF unlock is available and lands on the app with no password typed.
      const biometricBtn = page.getByRole("button", { name: /Unlock with biometrics/i });
      await expect(biometricBtn).toBeVisible({ timeout: 10_000 });
      await biometricBtn.click();
      await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
      await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 15_000 });

      // Settings disable purges the enrollment record and the /unlock button.
      await openBiometricDialog(page);
      await page.getByRole("button", { name: "Disable biometric unlock" }).click();
      await expect(page.getByRole("button", { name: "Enable biometric unlock" })).toBeVisible({
        timeout: 10_000,
      });
      const record = await readIdbEnrollment(page);
      expect(record, "IDB record must be absent after disable").toBeNull();
      await closeBiometricDialog(page);
    } finally {
      await removeVirtualAuthenticator(page, authId);
    }
  });

  test("signing out from /unlock purges the enrollment record", async ({ page }) => {
    test.setTimeout(180_000);
    const { bioUser } = loadFixtures();
    const authId = await installVirtualAuthenticator(page);

    try {
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);
      await lockViaNav(page);

      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/auth\/login\/?$/, { timeout: 15_000 });

      const record = await readIdbEnrollment(page);
      expect(record, "locked-screen sign-out must purge the enrollment (R10)").toBeNull();
    } finally {
      await removeVirtualAuthenticator(page, authId);
    }
  });
});
