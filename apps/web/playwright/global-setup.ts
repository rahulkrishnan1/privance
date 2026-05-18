import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

/**
 * Global setup: pre-creates fixture users that most tests reuse.
 *
 * The server rate-limits signups to 3 per IP per minute. We create at most 3
 * users here, then sleep for 61 s to clear the sliding window before any test
 * starts. The signup spec creates one additional user at runtime (alice) which
 * lands in a fresh window.
 *
 * Fixtures written to .playwright-fixtures.json (gitignored).
 *
 * On subsequent local runs the fixture file is reused so we don't burn through
 * the rate-limit budget on every `pnpm e2e` invocation. Set FORCE_SETUP=1 or
 * delete the fixture file to force recreation (e.g. after a DB wipe).
 */

const FIXTURES_PATH = path.join(__dirname, "../.playwright-fixtures.json");
const BASE_URL = "http://localhost:8081";
const PASSWORD = "Privance-e2e-passphrase-2026!";

export type Fixtures = {
  sharedUser: { username: string; password: string };
  duplicateUser: { username: string; password: string };
  recoveryUser: { username: string; password: string; phrase: string };
};

async function signupUser(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  username: string,
  password: string,
): Promise<{ phrase: string }> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();

  await page.goto("/auth/signup/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Master password", { exact: true }).fill(password);
  await page.getByLabel("Confirm master password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Wait for phrase screen (argon2 × 2 + HIBP = up to 15 s)
  await page
    .getByText("Write down your recovery phrase")
    .waitFor({ state: "visible", timeout: 45_000 });

  // Capture words from the 4×3 grid
  const fieldset = page.locator("fieldset").filter({
    has: page.locator("legend", { hasText: "Recovery phrase words" }),
  });
  const wordCells = fieldset.locator("div.flex.flex-col.gap-0\\.5");
  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const word = await wordCells.nth(i).locator("span").nth(1).innerText();
    words.push(word.trim());
  }
  const phrase = words.join(" ");

  // Acknowledge
  await page.getByLabel("I have written down my recovery phrase in a safe place.").check();
  await page.getByRole("button", { name: "Continue" }).click();

  await ctx.close();
  return { phrase };
}

export default async function globalSetup(): Promise<void> {
  // Reuse existing fixtures on local re-runs to avoid burning through the
  // 3-per-minute signup rate limit. CI never has the file (it's gitignored).
  if (process.env.FORCE_SETUP !== "1" && fs.existsSync(FIXTURES_PATH)) {
    // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
    console.log("[global-setup] Reusing existing fixtures from", FIXTURES_PATH);
    return;
  }

  const run = Date.now().toString(36);

  const browser = await chromium.launch();

  const sharedUsername = `shared-${run}`;
  const duplicateUsername = `dup-${run}`;
  const recoveryUsername = `recovery-${run}`;

  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Creating fixture users (3 signups)…");

  // Signup 1 — shared user for login/logout/accounts/holdings/dashboard
  await signupUser(browser, sharedUsername, PASSWORD);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Created shared user:", sharedUsername);

  // Signup 2 — user that exists for the duplicate-signup test
  await signupUser(browser, duplicateUsername, PASSWORD);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Created duplicate-target user:", duplicateUsername);

  // Signup 3 — recovery user (phrase is saved so the recovery test can use it)
  const { phrase: recoveryPhrase } = await signupUser(browser, recoveryUsername, PASSWORD);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Created recovery user:", recoveryUsername);

  await browser.close();

  const fixtures: Fixtures = {
    sharedUser: { username: sharedUsername, password: PASSWORD },
    duplicateUser: { username: duplicateUsername, password: PASSWORD },
    recoveryUser: { username: recoveryUsername, password: PASSWORD, phrase: recoveryPhrase },
  };
  fs.writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2));
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Fixtures saved to", FIXTURES_PATH);

  // The server rate-limits to 3 signups per IP per minute.
  // Sleep 61 s so the sliding window clears before the test suite's first
  // signup (the "signs up a new user" test, which creates alice).
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Waiting 61 s for rate-limit window to clear…");
  await sleep(61_000);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Ready.");
}
