import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import {
  loginAndCapture,
  logout,
  recover,
  restoreSession,
  signup,
  signupAndLogin,
} from "./helpers/auth";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

// One fresh username suffix per test run (RUN is module-level, evaluated once)
const RUN = Date.now().toString(36);
const PASS = "Privance-e2e-passphrase-2026!";

// Login once for sharedUser; reused by login, logout, recovery tests so we
// don't burn extra rate-limit slots on the same username.
let sharedSession: SessionSnapshot;

test.beforeAll(async ({ browser }) => {
  const { sharedUser } = loadFixtures();
  sharedSession = await loginAndCapture(browser, {
    username: sharedUser.username,
    password: sharedUser.password,
  });
});

// Creates a brand-new user at runtime; rate limits are lifted for E2E
// (RATE_LIMIT_SIGNUP_PER_IP=1000), so a fresh signup costs nothing.
test.describe("auth - sign up", () => {
  test("signs up a new user and lands on the app", async ({ browser }) => {
    const username = `alice-${RUN}`;

    const { session } = await signupAndLogin(browser, { username, password: PASS });

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, session);

    await page.goto("/app/");
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await ctx.close();
  });
});

test.describe("auth - duplicate username", () => {
  // Chromium only: the signup KDF derivation is redundant on firefox/webkit and
  // the duplicate-username check is browser-agnostic server logic.
  test.skip(({ browserName }) => browserName !== "chromium", "chromium-only");

  test("shows username-taken error on duplicate signup", async ({ page }) => {
    const { duplicateUser } = loadFixtures();

    await page.goto("/auth/signup/");
    await page.getByLabel("Username").fill(duplicateUser.username);
    await page.getByLabel("Master password", { exact: true }).fill(duplicateUser.password);
    await page.getByLabel("Confirm master password").fill(duplicateUser.password);
    await page.getByRole("button", { name: "Continue" }).click();

    // KDF runs in the browser before the server check; the error surfaces after it.
    await expect(page.getByText(/usernames are first come/i)).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe("auth - account recovery", () => {
  test("recovers an account with the 12-word phrase", async ({ browser }) => {
    // Signs up a fresh user (to avoid a stale-phrase problem across reruns, since
    // recovery replaces the phrase) then recovers with a new password and verifies
    // the new credentials reach the app.
    test.setTimeout(240_000);
    const username = `recv-${RUN}`;
    const origPass = PASS;
    const newPass = "Privance-e2e-recovery-new-2026!";

    // Step 1: signup to get the phrase; the shared helper retries transient failures.
    const signupCtx = await browser.newContext({ baseURL: BASE_URL });
    const signupPage = await signupCtx.newPage();
    const { phrase } = await signup(signupPage, { username, password: origPass });
    await signupCtx.close();

    // Step 2: recover using the captured phrase.
    const recoveryCtx = await browser.newContext({ baseURL: BASE_URL });
    const recoveryPage = await recoveryCtx.newPage();
    const { newPhrase } = await recover(recoveryPage, {
      username,
      phrase,
      newPassword: newPass,
    });
    await recoveryCtx.close();

    // A new phrase must be issued (must differ from the original).
    expect(newPhrase).toBeTruthy();
    expect(newPhrase.split(" ")).toHaveLength(12);
    expect(newPhrase).not.toBe(phrase);

    // Step 3: verify the new credentials actually work.
    const loginSession = await loginAndCapture(browser, { username, password: newPass });

    const verifyCtx = await browser.newContext({ baseURL: BASE_URL });
    const verifyPage = await verifyCtx.newPage();
    await restoreSession(verifyPage, loginSession);
    await verifyPage.goto("/app/");
    await expect(verifyPage).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(verifyPage.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await verifyCtx.close();
  });
});

test.describe("auth - login", () => {
  test("logs in with valid credentials and reaches the app", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, sharedSession);

    await page.goto("/app/");
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await ctx.close();
  });
});

test.describe("auth - logout", () => {
  test("logs out clears DEK and redirects to login", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, sharedSession);

    // Confirm we are in the app
    await page.goto("/app/");
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });

    await logout(page);

    await expect(page.getByRole("heading", { name: /unlock your vault/i })).toBeVisible();
    await ctx.close();

    // Open a fresh context (no DEK, no valid session) and verify "/" redirects to login.
    const freshCtx = await browser.newContext({ baseURL: BASE_URL });
    const freshPage = await freshCtx.newPage();
    await freshPage.goto("/app/");
    await expect(freshPage).toHaveURL(/\/auth\/login/, { timeout: 15_000 });
    await freshCtx.close();
  });
});

test.describe("auth - protected route redirects", () => {
  test("protected route redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/app/");
    // The React effect fires after mount and redirects to /auth/login
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });
  });
});
