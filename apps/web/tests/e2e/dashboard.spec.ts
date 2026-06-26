import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { loginAndCapture, restoreSession, waitForSynced } from "./helpers/auth";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

const RUN = Date.now().toString(36);

// Uses recoveryUser (from globalSetup fixtures) which never has accounts added
// in any E2E test, so it always shows the empty dashboard state. This avoids
// burning a signup slot, which can be unreliable when the rate limit
// (3 signups / 60 s / IP) is already close to the edge.
test.describe("dashboard - empty state", () => {
  test("with no data shows the empty state", async ({ browser }) => {
    const { recoveryUser } = loadFixtures();
    const session = await loginAndCapture(browser, {
      username: recoveryUser.username,
      password: recoveryUser.password,
    });

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, session);

    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });

    // recoveryUser has no accounts → the invest empty state ("Your vault is
    // empty, and sealed.") with an "Add first account" button.
    await expect(page.getByRole("heading", { name: /vault is empty/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: /Add first account/i })).toBeVisible();
    await ctx.close();
  });
});

// Login once in beforeAll and inject DEK + cookies in beforeEach so we only
// burn one login attempt per test run (avoids the 5/min per-username limit).
let savedSession: SessionSnapshot;
let dataSetupDone = false;

async function ensureDataSetup(browser: import("@playwright/test").Browser): Promise<void> {
  if (dataSetupDone) return;
  const { sharedUser } = loadFixtures();

  savedSession = await loginAndCapture(browser, {
    username: sharedUser.username,
    password: sharedUser.password,
  });

  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  await restoreSession(page, savedSession);

  await page.goto("/app/accounts/");
  await expect(page).toHaveURL("/app/accounts/", { timeout: 15_000 });
  await expect(
    page
      .getByRole("heading", { name: /vault is empty/i })
      .or(page.getByRole("navigation", { name: "Invest sub-navigation" })),
  ).toBeVisible({ timeout: 15_000 });
  await waitForSynced(page);

  await page
    .getByRole("button", { name: /Add.*account/i })
    .first()
    .click();
  const d = page.getByRole("dialog", { name: /Add account/i });
  await expect(d).toBeVisible();
  await d.getByLabel("Name").fill(`Dashboard-Cash-${RUN}`);
  await d.getByRole("button", { name: "Cash" }).click();
  await d.getByLabel("Account type").selectOption("checking");
  await d.getByLabel("Current balance").fill("25000.00");
  await d.getByRole("button", { name: "Add account" }).click();
  await expect(d).not.toBeVisible({ timeout: 10_000 });

  dataSetupDone = true;
  await ctx.close();
}

test.describe("dashboard - with data", () => {
  test.beforeAll(async ({ browser }) => {
    await ensureDataSetup(browser);
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);

    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    // OPFS resolves locally so networkidle fires too early; wait for the hero or subnav.
    await expect(
      page
        .getByTestId("invest-net-worth")
        .or(page.getByRole("navigation", { name: "Invest sub-navigation" })),
    ).toBeVisible({ timeout: 15_000 });
    await waitForSynced(page);
  });

  test("net worth tile renders a real computed value, not $0 or NaN", async ({ page }) => {
    const value = page.getByTestId("invest-net-worth");
    await expect(value).toBeVisible({ timeout: 15_000 });
    await expect(value).toHaveText(/\$[\d,]+/, { timeout: 15_000 });
    const text = (await value.textContent()) ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toBe("$0");
  });

  test("net worth history chart shows the empty-state copy with only one day of data", async ({
    page,
  }) => {
    // The setup account is one day old, so the chart cannot draw a line yet and
    // must show the friendly empty-state, not a blank/broken plot.
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
