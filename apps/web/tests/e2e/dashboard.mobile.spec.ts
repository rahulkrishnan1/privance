/**
 * Dashboard on the mobile UI.
 *
 * The dashboard collapses its desktop multi-column grid to a single column at
 * the mobile breakpoint. This verifies the screen still renders its core pieces
 * (net-worth tile, composition, history chart) with data at a phone viewport.
 *
 * Matches *.mobile.spec.ts, so it runs under the mobile projects (iPhone /
 * Pixel 5).
 */

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
const SAVE_TIMEOUT = 30_000;

let savedSession: SessionSnapshot;

test.describe("dashboard mobile", () => {
  // Seed one cash account so the dashboard renders its data state (not the empty
  // state). Use duplicateUser, which other specs only ever log into and never
  // give holdings: a cash-only account means no per-holding price fetch, so the
  // dashboard reaches its ready state deterministically rather than sitting in
  // loading behind sharedUser's cross-spec holding pile. global-setup wipes the
  // user's sync rows each run.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const { duplicateUser } = loadFixtures();
    savedSession = await loginAndCapture(browser, {
      username: duplicateUser.username,
      password: duplicateUser.password,
    });

    const ctx = await browser.newContext({ baseURL: "http://localhost:8081" });
    const page = await ctx.newPage();
    await restoreSession(page, savedSession);
    await page.goto("/app/accounts/");
    await expect(
      page
        .getByRole("heading", { name: "Accounts" })
        .or(page.getByRole("heading", { name: "Add your first account" })),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("button", { name: /Add.*account/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: /Add account/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Account name").fill(`MobDash-${RUN}`);
    await dialog.getByLabel("Balance").fill("4200.00");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
    // Let the sync push the new account to the server before closing: the test
    // runs in a fresh context with isolated OPFS, so it only sees server-synced
    // data, not this setup context's local store.
    await page.waitForLoadState("networkidle");
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);
  });

  test("renders the net-worth, composition, and history pieces at a phone viewport", async ({
    page,
  }) => {
    await page.goto("/app/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    // Net worth KPI renders a real computed value (not $0 or NaN). The fixture
    // user accumulates data across specs in a run, so assert the shape, not a
    // specific amount, exactly as the desktop dashboard spec does.
    const netWorth = page.getByTestId("net-worth-value");
    await expect(netWorth).toBeVisible({ timeout: SAVE_TIMEOUT });
    await expect(netWorth).toHaveText(/\$[\d,]+\.\d{2}/, { timeout: SAVE_TIMEOUT });
    expect((await netWorth.textContent())?.trim()).not.toBe("$0.00");

    // Composition and history cards render (the chart is a role="img" label).
    await expect(page.getByText("Composition")).toBeVisible();
    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible();

    // The history range selector is reachable and switchable on touch.
    await page.getByRole("button", { name: "1W range" }).click();
    await expect(page.getByRole("button", { name: "1W range", pressed: true })).toBeVisible();
  });
});
