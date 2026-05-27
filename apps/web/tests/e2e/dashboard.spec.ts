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

// ---------------------------------------------------------------------------
// Dashboard — empty state
// Uses recoveryUser (from globalSetup fixtures) which never has accounts added
// in any E2E test, so it always shows the empty dashboard state.
// This avoids burning a signup slot, which can be unreliable when the rate
// limit (3 signups / 60 s / IP) is already close to the edge.
// ---------------------------------------------------------------------------

test.describe("dashboard — empty state", () => {
  test("with no data shows the empty state", async ({ browser }) => {
    const { recoveryUser } = loadFixtures();
    const session = await loginAndCapture(browser, {
      username: recoveryUser.username,
      password: recoveryUser.password,
    });

    const ctx = await browser.newContext({ baseURL: "http://localhost:8081" });
    const page = await ctx.newPage();
    await restoreSession(page, session);

    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });

    // recoveryUser has no accounts → empty dashboard state
    await expect(page.getByRole("heading", { name: "Welcome to Privance" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: "Add account" })).toBeVisible();
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// Dashboard — with data
// Login once in beforeAll and inject DEK + cookies in beforeEach so we only
// burn one login attempt per test run (avoids the 5/min per-username limit).
// ---------------------------------------------------------------------------

let savedSession: SessionSnapshot;
let dataSetupDone = false;

async function ensureDataSetup(browser: import("@playwright/test").Browser): Promise<void> {
  if (dataSetupDone) return;
  const { sharedUser } = loadFixtures();

  savedSession = await loginAndCapture(browser, {
    username: sharedUser.username,
    password: sharedUser.password,
  });

  // Add a cash account via a page that has the DEK injected
  const ctx = await browser.newContext({ baseURL: "http://localhost:8081" });
  const page = await ctx.newPage();
  await restoreSession(page, savedSession);

  await page.goto("/app/accounts/");
  await expect(
    page
      .getByRole("heading", { name: "Accounts" })
      .or(page.getByRole("heading", { name: "Add your first account" })),
  ).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole("button", { name: /Add.*account/i })
    .first()
    .click();
  const d = page.getByRole("dialog", { name: /Add account/i });
  await expect(d).toBeVisible();
  await d.getByLabel("Account name").fill(`Dashboard-Cash-${RUN}`);
  await d.getByLabel("Balance").fill("25000.00");
  await d.getByRole("button", { name: "Save" }).click();
  await expect(d).not.toBeVisible({ timeout: 10_000 });

  dataSetupDone = true;
  await ctx.close();
}

test.describe("dashboard — with data", () => {
  test.beforeAll(async ({ browser }) => {
    await ensureDataSetup(browser);
  });

  test.beforeEach(async ({ page }) => {
    // Inject DEK + session cookie before any navigation so AuthProvider
    // initialises as "unlocked" on first render.
    await restoreSession(page, savedSession);

    // Navigate to the dashboard
    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
  });

  test("shows the net worth tile after accounts are added", async ({ page }) => {
    // With a cash account present, the dashboard shows the net worth tile
    await expect(page.getByText(/Last refreshed:/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Refresh prices/i })).toBeVisible();
  });

  test("net worth history chart is present", async ({ page }) => {
    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("range selector switches between ranges", async ({ page }) => {
    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible({
      timeout: 15_000,
    });

    const ranges = ["1M", "3M", "1Y", "All"] as const;
    for (const range of ranges) {
      await page.getByRole("button", { name: `${range} range` }).click();
      await expect(
        page.getByRole("button", { name: `${range} range`, pressed: true }),
      ).toBeVisible();
    }
  });
});
