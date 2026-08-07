/**
 * Biometric unlock E2E: AE1 only.
 *
 * AE1 verifies that non-PRF browsers (Firefox, WebKit) show no biometric UI,
 * since R2 gates all biometric features on PRF feature detection. It runs under
 * the webkit project.
 *
 * The CDP-PRF journeys (enroll → PRF unlock → disable, locked-screen sign-out)
 * live in biometric-prf.spec.ts, which is chromium-only because the virtual
 * WebAuthn authenticator is only available over CDP.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { fillLoginForm } from "./helpers/auth";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

// Two Argon2id derivations (login + possible unlock) dominate wall-clock.
test.setTimeout(90_000);

// AE1: skipped on chromium (CDP makes PRF available, so biometric UI IS shown there).
// Only runs on webkit where R2 feature detection gates it out.
test.describe("AE1: no biometric UI on non-PRF browsers", () => {
  test("settings shows no biometric section; /unlock shows no biometric button", async ({
    page,
  }) => {
    const { bioUser } = loadFixtures();

    await page.goto("/auth/login/");
    await fillLoginForm(page, bioUser.username, bioUser.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
    await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 10_000 });

    await page.goto("/app/settings/");
    await expect(page.getByRole("heading", { name: /The vault/ })).toBeVisible({
      timeout: 15_000,
    });

    // The biometric row must not be actionable (R2: isBiometricSupported() = false);
    // an unsupported device renders an inert "Unavailable" row, never a button.
    await expect(page.getByRole("button", { name: /Biometric unlock/ })).not.toBeVisible({
      timeout: 5_000,
    });

    // Lock and check /unlock.
    await page.getByLabel("Lock").first().click();
    await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Unlock with biometrics/i })).not.toBeVisible({
      timeout: 5_000,
    });
  });
});
