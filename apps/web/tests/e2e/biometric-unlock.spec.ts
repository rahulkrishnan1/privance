/**
 * Biometric unlock E2E tests (U7).
 *
 * Chromium-only scenarios use the CDP virtual WebAuthn authenticator with PRF.
 * Firefox and WebKit run only AE1 (no biometric UI on non-PRF browsers).
 *
 * Provisioning: uses the two fixture users added in global-setup.ts (bioUser,
 * bioAltUser). Zero signups happen in this spec; all tests load fixtures exactly
 * like session-persistence.spec.ts and log in via the inline form pattern.
 * Biometric state is browser-context-local (fresh per test) and the server stores
 * nothing biometric, so sharing two fixture users across all scenarios is safe.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
import {
  backdateBiometricRecord,
  installVirtualAuthenticator,
  readIdbEnrollment,
  removeVirtualAuthenticator,
  setUserVerified,
} from "./helpers/webauthn";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

// Two Argon2id derivations (login + possible unlock) dominate wall-clock.
test.setTimeout(90_000);

// ---------------------------------------------------------------------------
// Shared inline-login helper (pattern from session-persistence.spec.ts).
// Reaches an unlocked dashboard without restoreSession/installDekCapture.
// ---------------------------------------------------------------------------

async function inlineLogin(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/auth/login/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Master password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
  await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 10_000 });
}

// Lock via the top nav bar button (aria-label="Lock"). Using .first() avoids
// strict-mode violations when on the settings page where two Lock buttons exist.
async function lockViaNav(page: import("@playwright/test").Page): Promise<void> {
  await page.getByLabel("Lock").first().click();
  await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Unlock your/ })).toBeVisible({
    timeout: 10_000,
  });
}

// Enroll biometric unlock from the settings page (must be unlocked and on /app/settings/).
async function enrollBiometric(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app/settings/");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Biometric unlock" })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole("button", { name: "Enable biometric unlock" }).click();
  await expect(page.getByRole("button", { name: "Disable biometric unlock" })).toBeVisible({
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Smoke gate: proves CDP PRF end-to-end before the acceptance scenarios run.
// ---------------------------------------------------------------------------

test.describe("CDP-PRF smoke gate", () => {
  test("virtual authenticator surfaces PRF output and IDB record is populated", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

    const { bioUser } = loadFixtures();
    const authId = await installVirtualAuthenticator(page);

    try {
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);

      const record = await readIdbEnrollment(page);
      expect(record, "IDB enrollment record must be present after enrollment").not.toBeNull();
      expect(typeof (record as Record<string, unknown>).recordUuid).toBe("string");
      expect(typeof (record as Record<string, unknown>).userId).toBe("string");
      // wrappedItemsKey must be non-null: this proves the PRF path completed
      expect((record as Record<string, unknown>).wrappedItemsKey).not.toBeNull();
    } finally {
      await removeVirtualAuthenticator(page, authId);
    }
  });
});

// ---------------------------------------------------------------------------
// AE2: enroll -> create account -> lock -> biometric unlock lands on dashboard
// ---------------------------------------------------------------------------

test.describe("AE2: enroll, lock, biometric unlock", () => {
  test("biometric unlock lands on dashboard with seeded account balance (no password typed)", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

    const { bioUser } = loadFixtures();
    const authId = await installVirtualAuthenticator(page);

    try {
      await inlineLogin(page, bioUser.username, bioUser.password);

      // Seed a cash account with a known balance so we can assert real decrypted data.
      await page.goto("/app/accounts/");
      await expect(
        page
          .getByRole("heading", { name: "Accounts" })
          .or(page.getByRole("heading", { name: "Add your first account" })),
      ).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState("networkidle");

      // Add account only if not already present (bioUser is reused across runs).
      const existingBalance = page.getByText("AE2-Balance");
      const alreadySeeded = await existingBalance.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!alreadySeeded) {
        await page
          .getByRole("button", { name: /Add.*account/i })
          .first()
          .click();
        const dialog = page.getByRole("dialog", { name: /Add account/i });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel("Account name").fill("AE2-Balance");
        await dialog.getByLabel("Balance").fill("12345.00");
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(dialog).not.toBeVisible({ timeout: 30_000 });
        await expect(page.getByText("AE2-Balance")).toBeVisible({ timeout: 30_000 });
      }

      await enrollBiometric(page);
      await lockViaNav(page);

      const biometricBtn = page.getByRole("button", { name: /Unlock with biometrics/i });
      await expect(biometricBtn).toBeVisible({ timeout: 10_000 });

      // Biometric unlock: no password typed.
      await biometricBtn.click();
      await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
      await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 15_000 });

      // Assert real decrypted data is visible (proves the items key came from PRF unwrap).
      await page.goto("/app/accounts/");
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("AE2-Balance")).toBeVisible({ timeout: 15_000 });
    } finally {
      await removeVirtualAuthenticator(page, authId);
    }
  });
});

// ---------------------------------------------------------------------------
// AE3: cadence expiry, current semantics
//
// loadEnrollment on an expired record destroys wrappedItemsKey (sets to null)
// but leaves bookkeeping (recordUuid, credentialId, etc.) intact.
// After password unlock, reArm re-wraps fresh under the stored public key and
// updates lastPasswordUnlockAt, so the biometric button returns with the same recordUuid.
// ---------------------------------------------------------------------------

test.describe("AE3: cadence expiry (new semantics)", () => {
  test("expired cadence nulls wrappedItemsKey, password unlock re-arms, biometric returns with same recordUuid", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

    const { bioUser } = loadFixtures();
    const authId = await installVirtualAuthenticator(page);

    try {
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);

      // Capture the recordUuid before backdating so we can assert identity after re-arm.
      const recordBefore = await readIdbEnrollment(page);
      expect(recordBefore).not.toBeNull();
      const originalRecordUuid = (recordBefore as Record<string, unknown>).recordUuid as string;

      // Backdate lastPasswordUnlockAt by 15 days to trigger cadence expiry.
      await backdateBiometricRecord(page, 15 * 24 * 60 * 60 * 1000);

      // Lock so the unlock page runs a fresh loadEnrollment (which applies the expiry check).
      await lockViaNav(page);

      // Biometric button must NOT be present (cadence expired, no usable enrollment).
      await expect(page.getByRole("button", { name: /Unlock with biometrics/i })).not.toBeVisible({
        timeout: 8_000,
      });

      // At-rest: the record must still exist in IDB (bookkeeping survives) but
      // wrappedItemsKey must be null (only the key material is destroyed, R9/F3).
      const recordAfterExpiry = await readIdbEnrollment(page);
      expect(
        recordAfterExpiry,
        "bookkeeping must survive cadence expiry (R9): record should not be null",
      ).not.toBeNull();
      expect(
        (recordAfterExpiry as Record<string, unknown>).wrappedItemsKey,
        "wrappedItemsKey must be null after cadence expiry (at-rest copy destroyed)",
      ).toBeNull();
      expect(
        (recordAfterExpiry as Record<string, unknown>).recordUuid,
        "recordUuid must be preserved after expiry",
      ).toBe(originalRecordUuid);

      // Password unlock re-arms: reArm wraps fresh under stored public key.
      await page.getByLabel("Master password").fill(bioUser.password);
      await page.getByRole("button", { name: "Unlock" }).click();
      await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
      await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 10_000 });

      // Lock again to see the unlock screen with the re-armed state.
      await lockViaNav(page);

      // Biometric button must be BACK (re-arm restored a fresh wrappedItemsKey).
      await expect(page.getByRole("button", { name: /Unlock with biometrics/i })).toBeVisible({
        timeout: 10_000,
      });

      // IDB must show a non-null wrappedItemsKey with the SAME recordUuid (re-arm,
      // not re-enrollment: R9/F3, no new passkey ceremony was performed).
      const recordAfterReArm = await readIdbEnrollment(page);
      expect(recordAfterReArm).not.toBeNull();
      expect(
        (recordAfterReArm as Record<string, unknown>).wrappedItemsKey,
        "wrappedItemsKey must be non-null after re-arm",
      ).not.toBeNull();
      expect(
        (recordAfterReArm as Record<string, unknown>).recordUuid,
        "recordUuid must be the same after re-arm (no new passkey ceremony)",
      ).toBe(originalRecordUuid);
    } finally {
      await removeVirtualAuthenticator(page, authId);
    }
  });
});

// ---------------------------------------------------------------------------
// AE4: UV denial leaves unlock screen usable and enrollment intact
//
// UV is denied on the SAME authenticator that holds the enrolled credential
// (CDP WebAuthn.setUserVerified), so the assertion exercises genuine UV denial
// rather than a credential-not-found failure. With userVerification "required"
// and UV failing, the ceremony rejects with NotAllowedError, which the app maps
// to the cancel path (screen intact, enrollment retained, R8). U5's mocked
// browser test is the authoritative cancel-path coverage.
// ---------------------------------------------------------------------------

test.describe("AE4: UV denial", () => {
  test("UV-denied assertion leaves unlock screen usable and enrollment intact", async ({
    browser,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

    const { bioUser } = loadFixtures();
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();

    try {
      const authId = await installVirtualAuthenticator(page);
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);

      // Deny UV on the authenticator that holds the enrolled credential.
      await setUserVerified(page, authId, false);

      await lockViaNav(page);

      const biometricBtn = page.getByRole("button", { name: /Unlock with biometrics/i });
      await expect(biometricBtn).toBeVisible({ timeout: 10_000 });

      // Attempt biometric unlock with UV denied.
      await biometricBtn.click();

      // Wait for the pending state to resolve (button re-enabled).
      await expect(biometricBtn).not.toBeDisabled({ timeout: 8_000 });

      // Screen must still be at /unlock (no navigation away).
      expect(page.url()).toMatch(/\/unlock\/?$/);

      // Password path remains one tap away: reveal it and confirm the form.
      await page.getByRole("button", { name: "Use master password instead" }).click();
      await expect(page.getByLabel("Master password")).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeVisible({
        timeout: 5_000,
      });

      // Enrollment record must still be present (cancel does not purge, R8).
      const record = await readIdbEnrollment(page);
      expect(record, "enrollment record must survive a UV-denied attempt (R8)").not.toBeNull();

      await removeVirtualAuthenticator(page, authId);
    } finally {
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AE5: logout purges enrollment (RESOLVED CONTRACT)
//
// R10: logout purges the FULL record (not just wrappedItemsKey).
// reArm is a no-op on an absent record so it cannot resurrect the enrollment.
// After logout + re-login, biometric is NOT available until explicit re-enrollment.
// ADR-0005: "until the post-sign-in re-arm" from the origin AE5 phrase is
// superseded by the full-purge decision.
// ---------------------------------------------------------------------------

test.describe("AE5: logout purges enrollment", () => {
  test("logout purges enrollment; biometric unavailable until re-enroll after sign-in", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

    const { bioUser } = loadFixtures();
    const authId = await installVirtualAuthenticator(page);

    try {
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);

      const recordBeforeLogout = await readIdbEnrollment(page);
      expect(recordBeforeLogout, "IDB record must exist before logout").not.toBeNull();

      // Sign out via the nav bar (real logout path, includes purgeEnrollment).
      await page.getByLabel("Sign out").click();
      await expect(page).toHaveURL(/\/auth\/login\/?$/, { timeout: 45_000 });

      // Full record must be absent after logout (R10).
      const recordAfterLogout = await readIdbEnrollment(page);
      expect(recordAfterLogout, "enrollment must be fully purged after logout (R10)").toBeNull();

      // Sign back in. Use explicit goto + fill so any hard reload from
      // window.location.replace in handleLogout does not race with the form fill.
      await inlineLogin(page, bioUser.username, bioUser.password);

      // Biometric must NOT be available (re-arm is no-op on absent record).
      await page.goto("/app/settings/");
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
        timeout: 15_000,
      });
      const section = page.getByRole("region", { name: "Biometric unlock" });
      const sectionVisible = await section.isVisible({ timeout: 5_000 }).catch(() => false);
      if (sectionVisible) {
        // Section visible means the device supports biometrics; button must show "Enable".
        await expect(page.getByRole("button", { name: "Enable biometric unlock" })).toBeVisible({
          timeout: 5_000,
        });
      }

      // IDB must still be absent after re-login (re-arm is a no-op, R9).
      const recordAfterRelogin = await readIdbEnrollment(page);
      expect(
        recordAfterRelogin,
        "re-arm is a no-op on absent record; IDB must still be null after re-login",
      ).toBeNull();
    } finally {
      await removeVirtualAuthenticator(page, authId);
    }
  });
});

// ---------------------------------------------------------------------------
// AE6: explicit Lock keeps enrollment intact; biometric unlock works
// ---------------------------------------------------------------------------

test.describe("AE6: lock retains enrollment", () => {
  test("explicit Lock keeps biometric action available and biometric unlock succeeds", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

    const { bioUser } = loadFixtures();
    const authId = await installVirtualAuthenticator(page);

    try {
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);

      // Lock via nav (not logout: enrollment must survive, R11).
      await lockViaNav(page);

      const biometricBtn = page.getByRole("button", { name: /Unlock with biometrics/i });
      await expect(biometricBtn).toBeVisible({ timeout: 10_000 });

      // Tap biometric unlock.
      await biometricBtn.click();
      await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
      await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 15_000 });
    } finally {
      await removeVirtualAuthenticator(page, authId);
    }
  });
});

// ---------------------------------------------------------------------------
// Locked-screen sign-out purges enrollment (R10 via handleSignOut)
// ---------------------------------------------------------------------------

test.describe("locked-screen sign-out", () => {
  test("signing out from /unlock purges the enrollment record", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

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

// ---------------------------------------------------------------------------
// AE7: settings disable purges enrollment and shows OS-passkey notice
// ---------------------------------------------------------------------------

test.describe("AE7: settings disable", () => {
  test("disable purges enrollment and shows OS-passkey notice", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

    const { bioUser } = loadFixtures();
    const authId = await installVirtualAuthenticator(page);

    try {
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);

      await page.getByRole("button", { name: "Disable biometric unlock" }).click();

      // Settings must show "Enable" and the OS-passkey notice.
      await expect(page.getByRole("button", { name: "Enable biometric unlock" })).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByText(/passkey remains in your device credential manager/i),
      ).toBeVisible({ timeout: 5_000 });

      // IDB record must be fully absent.
      const record = await readIdbEnrollment(page);
      expect(record, "IDB record must be absent after disable").toBeNull();

      // Lock and confirm no biometric button on unlock screen.
      await lockViaNav(page);
      await expect(page.getByRole("button", { name: /Unlock with biometrics/i })).not.toBeVisible({
        timeout: 8_000,
      });
    } finally {
      await removeVirtualAuthenticator(page, authId);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-user guard: bioUser enrolls, simulate failed logout purge, bioAltUser
// signs in -> userId mismatch purges bioUser's record.
// ---------------------------------------------------------------------------

test.describe("cross-user guard (userId mismatch purge)", () => {
  test("enrollment purged when a different user signs in on the same browser", async ({
    browser,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "chromium-only: CDP virtual authenticator");

    const { bioUser, bioAltUser } = loadFixtures();
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();

    try {
      // Enroll as bioUser.
      const authId = await installVirtualAuthenticator(page);
      await inlineLogin(page, bioUser.username, bioUser.password);
      await enrollBiometric(page);

      const recordBefore = await readIdbEnrollment(page);
      expect(recordBefore, "bioUser IDB record must exist before cross-user test").not.toBeNull();

      // Simulate a failed logout purge: clear localStorage auth keys (remove the
      // session cookie via the server would require a real logout; here we just
      // remove the localStorage USERNAME_KEY so the app sees a different user
      // on next login) while leaving IDB intact. This gives loadEnrollment the
      // chance to fire its userId mismatch guard.
      await page.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          localStorage.removeItem(key);
        }
      });

      await removeVirtualAuthenticator(page, authId);

      // Sign in as bioAltUser using the virtual authenticator (it needs WebAuthn
      // enabled for the settings page to show the biometric section).
      const authIdAlt = await installVirtualAuthenticator(page);
      await page.goto("/auth/login/");
      await page.getByLabel("Username").fill(bioAltUser.username);
      await page.getByLabel("Master password").fill(bioAltUser.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
      await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 10_000 });

      // Navigate to settings; userId mismatch purge fires on loadEnrollment.
      await page.goto("/app/settings/");
      await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
        timeout: 15_000,
      });

      // If the biometric section is visible, it must show "Enable" (record purged).
      const section = page.getByRole("region", { name: "Biometric unlock" });
      const sectionVisible = await section.isVisible({ timeout: 5_000 }).catch(() => false);
      if (sectionVisible) {
        await expect(page.getByRole("button", { name: "Enable biometric unlock" })).toBeVisible({
          timeout: 5_000,
        });
      }

      // IDB must be absent (mismatch purge).
      const record = await readIdbEnrollment(page);
      expect(
        record,
        "bioUser's enrollment must be purged when bioAltUser loads settings (userId mismatch)",
      ).toBeNull();

      // Lock and confirm no biometric button.
      await lockViaNav(page);
      await expect(page.getByRole("button", { name: /Unlock with biometrics/i })).not.toBeVisible({
        timeout: 5_000,
      });

      await removeVirtualAuthenticator(page, authIdAlt);
    } finally {
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AE1: no biometric UI on firefox + webkit (R2: feature detection gates all UI)
// Skipped on chromium where the CDP virtual authenticator makes PRF available.
// ---------------------------------------------------------------------------

test.describe("AE1: no biometric UI on non-PRF browsers", () => {
  test.skip(({ browserName }) => browserName === "chromium", "firefox/webkit only for AE1");

  test("settings shows no biometric section; /unlock shows no biometric button", async ({
    page,
  }) => {
    const { bioUser } = loadFixtures();

    await page.goto("/auth/login/");
    await page.getByLabel("Username").fill(bioUser.username);
    await page.getByLabel("Master password").fill(bioUser.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
    await expect(page.getByLabel("Lock")).toBeVisible({ timeout: 10_000 });

    await page.goto("/app/settings/");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 15_000,
    });

    // Biometric section must not be rendered (R2: isBiometricSupported() = false).
    await expect(page.getByRole("region", { name: "Biometric unlock" })).not.toBeVisible({
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
