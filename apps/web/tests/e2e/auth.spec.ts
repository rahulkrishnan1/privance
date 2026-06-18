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

// Login once for sharedUser; reused by login, logout, and unlock tests so we
// don't burn extra rate-limit slots on the same username.
let sharedSession: SessionSnapshot;

test.beforeAll(async ({ browser }) => {
  const { sharedUser } = loadFixtures();
  sharedSession = await loginAndCapture(browser, {
    username: sharedUser.username,
    password: sharedUser.password,
  });
});

// Creates a brand-new user at runtime; one signup after the globalSetup
// rate-limit cooldown.
test.describe("auth - sign up", () => {
  test("signs up a new user and lands on the app", async ({ browser }) => {
    const username = `alice-${RUN}`;

    const { session } = await signupAndLogin(browser, { username, password: PASS });

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, session);

    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await ctx.close();
  });
});

test.describe("auth - login", () => {
  test("logs in with valid credentials and reaches the app", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, sharedSession);

    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await ctx.close();
  });
});

// duplicateUser from globalSetup already exists, so a second signup returns 409.
test.describe("auth - duplicate username", () => {
  test("shows username-taken error on duplicate signup", async ({ page }) => {
    const { duplicateUser } = loadFixtures();

    await page.goto("/auth/signup/");
    await page.getByLabel("Username").fill(duplicateUser.username);
    await page.getByLabel("Master password", { exact: true }).fill(duplicateUser.password);
    await page.getByLabel("Confirm master password").fill(duplicateUser.password);
    await page.getByRole("button", { name: "Continue" }).click();

    // argon2 in the browser runs before the server check (~3-8 s)
    await expect(page.getByText(/usernames are first come/i)).toBeVisible({
      timeout: 30_000,
    });
  });
});

// Creates a fresh user (to avoid stale-phrase problem across test reruns) then
// recovers the account using the phrase from signup. The "fresh user" signup
// consumes one of the post-globalSetup rate-limit slots. The slot budget is:
//   slot 1: alice (sign-up test above)
//   slot 2: this recovery test
//   slot 3: dash-empty (dashboard spec)
// All three are in separate test.describe blocks that run serially (workers=1).
test.describe("auth - account recovery", () => {
  test("recovers an account with the 12-word phrase", async ({ browser }) => {
    // Signup + two Argon2 recovery derivations; the signup also queues against
    // the shared per-IP rate limit when the whole matrix runs.
    test.setTimeout(240_000);
    // Create a fresh account so we have a known phrase
    const username = `recv-${RUN}`;
    const origPass = PASS;
    const newPass = "Privance-e2e-recovery-new-2026!";

    // Step 1: signup to get the phrase. The shared helper is hydration-safe and
    // retries through the per-IP signup budget, so it survives the full-suite
    // load on firefox/webkit where an inline signup races the rate limit.
    const signupCtx = await browser.newContext({ baseURL: BASE_URL });
    const signupPage = await signupCtx.newPage();
    const { phrase } = await signup(signupPage, { username, password: origPass });
    await signupCtx.close();

    // Step 2: recover using the captured phrase
    const recoveryCtx = await browser.newContext({ baseURL: BASE_URL });
    const recoveryPage = await recoveryCtx.newPage();
    const { newPhrase } = await recover(recoveryPage, { username, phrase, newPassword: newPass });
    await recoveryCtx.close();

    // A new phrase must be issued (must differ from the original)
    expect(newPhrase).toBeTruthy();
    expect(newPhrase.split(" ")).toHaveLength(12);

    // Step 3: verify the new credentials actually work
    const loginSession = await loginAndCapture(browser, {
      username,
      password: newPass,
    });

    const verifyCtx = await browser.newContext({ baseURL: BASE_URL });
    const verifyPage = await verifyCtx.newPage();
    await restoreSession(verifyPage, loginSession);
    await verifyPage.goto("/app/");
    await expect(verifyPage).toHaveURL("/app/", { timeout: 15_000 });
    await expect(verifyPage.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await verifyCtx.close();
  });
});

test.describe("auth - logout", () => {
  test("logs out clears DEK and redirects to login", async ({ browser }) => {
    // restoreSession injects both cookies and DEK, so the dashboard renders
    // without an extra login.
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, sharedSession);

    // Confirm we are in the app
    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Invest" }).first()).toBeVisible({
      timeout: 10_000,
    });

    await logout(page);

    await expect(page.getByRole("heading", { name: /unlock your vault/i })).toBeVisible();
    await ctx.close();

    // Open a fresh context (no DEK, no valid session) and verify "/" redirects to login.
    // We use a fresh context rather than re-navigating in the same page because
    // addInitScript (installed by restoreSession) re-injects the DEK on every
    // navigation within a page's lifetime; the fresh context has no such script.
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

  test("unlock page shows form when a valid session exists but DEK is missing", async ({
    browser,
  }) => {
    // Use recoveryUser (from globalSetup fixtures) to get a fresh valid session
    // without consuming sharedUser's rate-limit budget. The logout test runs
    // before this one and has revoked the sharedSession server-side, making
    // sharedSession cookies invalid for a real /api/auth/session check.
    const { recoveryUser } = loadFixtures();
    const snapshot = await loginAndCapture(browser, {
      username: recoveryUser.username,
      password: recoveryUser.password,
    });

    // Open a new context with the session cookie but without the DEK;
    // the unlock page checks the server session independently of the DEK.
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    await ctx.addCookies(snapshot.cookies);
    const page = await ctx.newPage();

    // "/app/" redirects to login (no DEK in globalThis)
    await page.goto("/app/");
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15_000 });

    // /unlock/ verifies the server session and shows the unlock form
    await page.goto("/unlock/");
    await expect(page.getByRole("heading", { name: /Master password|Welcome back/ })).toBeVisible({
      timeout: 10_000,
    });

    await ctx.close();
  });

  test("session-expired locked state shows the re-sealed scene on /unlock without looping (regression)", async ({
    page,
  }) => {
    // Seed a persisted username (the "this device has an account" marker) with no
    // session vault and no cookie: the locked-then-expired boot.
    await page.goto("/auth/login/");
    await page.evaluate(() => localStorage.setItem("privance.username", "ghost-user"));
    await page.context().clearCookies();

    // /unlock/ boots "locked" (username present, no vault), then its useEffect
    // calls authApi.session(), gets 401, runs the logout cleanup, and presents
    // the session-expired scene in place rather than hard-navigating away.
    // waitUntil:"commit" so the boot's own same-URL navigation can't "interrupt"
    // the goto on webkit (the scene assertion below is the real wait).
    await page.goto("/unlock/", { waitUntil: "commit" });

    await expect(page.getByRole("heading", { name: /sealed itself/i })).toBeVisible({
      timeout: 15_000,
    });

    // Stay on /unlock/ showing the cold scene; do not bounce to login or loop.
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/unlock\//);
    await expect(page.getByRole("button", { name: "Sign back in" })).toBeVisible();
  });
});
