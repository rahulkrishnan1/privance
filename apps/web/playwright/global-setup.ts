import fs from "node:fs";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import postgres from "postgres";
import { BASE_URL, wasWebServerPreexisting } from "./ports";

/**
 * Global setup: pre-creates fixture users that most tests reuse.
 *
 * Rate limits are lifted for E2E (RATE_LIMIT_SIGNUP_PER_IP=1000), so all 4
 * fixture users are created in one batch without sleeps.
 *
 * Fixtures written to .playwright-fixtures.json (gitignored).
 *
 * On subsequent local runs the fixture file is reused so we don't burn through
 * the rate-limit budget on every `pnpm e2e` invocation. Set FORCE_SETUP=1 or
 * delete the fixture file to force recreation (e.g. after a DB wipe).
 *
 * Because the local Postgres persists across runs while the fixture users are
 * reused, their sync data (accounts, holdings, daily net-worth snapshots) would
 * otherwise pile up run-over-run and day-over-day, eventually breaking
 * data-shape assertions (e.g. "only one day of history") and slowing the initial
 * sync into a timeout. So every reused run first wipes those users' sync rows,
 * giving each local run the same clean-data slate CI gets from its ephemeral DB.
 * The users themselves are kept so no new signups are needed.
 */

const FIXTURES_PATH = path.join(__dirname, "../.playwright-fixtures.json");
const PASSWORD = "Privance-e2e-passphrase-2026!";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance";

/** Wipes the per-user sync rows (accounts, holdings, snapshots) for the given
 *  users and the global price / symbol-profile caches so a reused run starts from
 *  clean data. Clearing the caches keeps prices deterministic: a prior session
 *  that ran against real upstreams (e.g. a stray `pnpm dev`) would otherwise
 *  leave real prices cached that the fake provider serves until they expire,
 *  breaking value assertions. Keeps the user rows so login still works without a
 *  fresh signup. Guarded to a local DB so a misconfigured DATABASE_URL can never
 *  delete rows in a shared or staging Postgres. */
async function resetFixtureData(usernames: string[]): Promise<void> {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL)) {
    // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
    console.warn("[global-setup] DATABASE_URL is not local; skipping fixture-data reset");
    return;
  }
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    // sync_objects.user_id is text; users.user_id is uuid, so cast to match.
    await sql`
      delete from sync_objects
      where user_id in (select user_id::text from users where username in ${sql(usernames)})
    `;
    await sql`delete from prices`;
    await sql`delete from symbol_profiles`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export type Fixtures = {
  sharedUser: { username: string; password: string };
  duplicateUser: { username: string; password: string };
  recoveryUser: { username: string; password: string; phrase: string };
  bioUser: { username: string; password: string };
};

async function signupUser(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  username: string,
  password: string,
): Promise<{ phrase: string }> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();

  await page.goto("/auth/signup/");
  // Retry until values stick and the Continue button enables.
  await page.getByLabel("Username").fill(username);
  await expect(async () => {
    if ((await page.getByLabel("Username").inputValue()) !== username) {
      await page.getByLabel("Username").fill(username);
    }
    if ((await page.getByLabel("Master password", { exact: true }).inputValue()) !== password) {
      await page.getByLabel("Master password", { exact: true }).fill(password);
      await page.getByLabel("Confirm master password").fill(password);
    }
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Continue" }).click();

  // Wait for phrase screen (argon2 × 2 = up to 15 s).
  // New UI heading: "Your recovery phrase." (fieldset with legend "Recovery phrase words")
  const fieldset = page.locator("fieldset").filter({
    has: page.locator("legend", { hasText: "Recovery phrase words" }),
  });
  await fieldset.waitFor({ state: "visible", timeout: 45_000 });

  // Capture words from the 3×4 grid.
  // Each cell: <div class="...bg-panel...flex..."><span>{num}</span>{word}</div>
  // The grid div is the direct child of the fieldset; word cells are its direct children.
  const gridDiv = fieldset.locator("div").first();
  const wordCells = gridDiv.locator("> div");
  await wordCells.first().waitFor({ state: "visible", timeout: 10_000 });
  const count = await wordCells.count();
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const cell = wordCells.nth(i);
    // innerText = "<num>\n<word>" or similar; strip the leading number.
    const raw = (await cell.innerText()).trim();
    words.push(raw.replace(/^\d+\s*/, "").trim());
  }
  const phrase = words.join(" ");

  // Acknowledge, new UI: different checkbox label + "I have it. Continue" button
  const newCheckbox = page.getByLabel("I wrote the phrase down, on paper, somewhere safe.");
  const oldCheckbox = page.getByLabel("I have written down my recovery phrase in a safe place.");
  const checkbox = (await newCheckbox.count()) > 0 ? newCheckbox : oldCheckbox;
  await checkbox.check();
  const newBtn = page.getByRole("button", { name: "I have it. Continue" });
  const oldBtn = page.getByRole("button", { name: "Continue" });
  const btn = (await newBtn.count()) > 0 ? newBtn : oldBtn;
  await btn.click();

  await ctx.close();
  return { phrase };
}

export default async function globalSetup(): Promise<void> {
  // Reuse existing fixtures on local re-runs. CI never has the file (gitignored).
  if (process.env.FORCE_SETUP !== "1" && fs.existsSync(FIXTURES_PATH)) {
    const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf8")) as Fixtures;
    // If the file predates the bioUser addition, treat it as stale and recreate.
    if (!fixtures.bioUser) {
      // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
      console.log("[global-setup] Stale fixtures (missing bioUser); recreating…");
      fs.unlinkSync(FIXTURES_PATH);
      // Fall through to the creation path below.
    } else {
      // Warn when a reused server may lack the reduced-KDF flag (v2), which
      // would silently slow every Argon2id derivation. ports.ts probes WEB_PORT
      // at config-load time, before Playwright starts its own webServer.
      if (process.env.CI !== "true" && (await wasWebServerPreexisting())) {
        // biome-ignore lint/suspicious/noConsole: reuse-risk warning during Playwright global setup
        console.warn(
          "[global-setup] Reusing a server already on :8081: it may lack NEXT_PUBLIC_PRIVANCE_KDF_REDUCED, disabling reduced KDF (v2).",
        );
      }
      // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
      console.log("[global-setup] Reusing fixtures; wiping their sync data for a clean run");
      await resetFixtureData([
        fixtures.sharedUser.username,
        fixtures.duplicateUser.username,
        fixtures.recoveryUser.username,
        fixtures.bioUser.username,
      ]);
      return;
    }
  }

  const run = Date.now().toString(36);

  const browser = await chromium.launch();

  const sharedUsername = `shared-${run}`;
  const duplicateUsername = `dup-${run}`;
  const recoveryUsername = `recovery-${run}`;
  const bioUsername = `bio-${run}`;

  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Creating fixture users (4 signups)…");

  // Signup 1: shared user for login/logout/accounts/holdings/dashboard
  await signupUser(browser, sharedUsername, PASSWORD);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Created shared user:", sharedUsername);

  // Signup 2: user that exists for the duplicate-signup test
  await signupUser(browser, duplicateUsername, PASSWORD);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Created duplicate-target user:", duplicateUsername);

  // Signup 3: recovery user (phrase is saved so the recovery test can use it)
  const { phrase: recoveryPhrase } = await signupUser(browser, recoveryUsername, PASSWORD);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Created recovery user:", recoveryUsername);

  // Signup 4: biometric test primary user
  await signupUser(browser, bioUsername, PASSWORD);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Created bio user:", bioUsername);

  await browser.close();

  const fixtures: Fixtures = {
    sharedUser: { username: sharedUsername, password: PASSWORD },
    duplicateUser: { username: duplicateUsername, password: PASSWORD },
    recoveryUser: { username: recoveryUsername, password: PASSWORD, phrase: recoveryPhrase },
    bioUser: { username: bioUsername, password: PASSWORD },
  };
  fs.writeFileSync(FIXTURES_PATH, JSON.stringify(fixtures, null, 2));
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Fixtures saved to", FIXTURES_PATH);
  // biome-ignore lint/suspicious/noConsole: progress output during Playwright global setup
  console.log("[global-setup] Ready.");
}
