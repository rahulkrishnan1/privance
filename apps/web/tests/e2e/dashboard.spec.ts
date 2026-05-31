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
    await expect(page.getByRole("heading", { name: /Track your net worth/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: /Add your first account/ })).toBeVisible();
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

  test("net worth tile renders a real computed value, not $0 or NaN", async ({ page }) => {
    // The shared user has accounts, so net worth must render as a well-formed,
    // non-zero currency value. (Asserting only that the tile is "visible" passed
    // even when the value was wrong, which is the fluff this replaces.)
    const value = page.getByTestId("net-worth-value");
    await expect(value).toBeVisible({ timeout: 15_000 });
    await expect(value).toHaveText(/\$[\d,]+\.\d{2}/, { timeout: 15_000 });
    const text = (await value.textContent()) ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toBe("$0.00");
  });

  test("net worth history chart shows the empty-state copy with only one day of data", async ({
    page,
  }) => {
    // The setup account is one day old, so the chart cannot draw a line yet and
    // must show the friendly empty-state, not a blank/broken plot. (The
    // multi-day rendered line + zoomed axis is covered by the Vitest Browser
    // Mode test history-chart.browser.test.tsx.)
    const card = page.getByRole("img", { name: "Net worth history chart" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(/Net worth history will appear after a few days/i)).toBeVisible();
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
