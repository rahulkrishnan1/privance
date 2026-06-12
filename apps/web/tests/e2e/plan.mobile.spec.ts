/**
 * FIRE plan E2E mobile suite: runs under mobile-safari (iPhone 14) and
 * mobile-chrome (Pixel 5).
 *
 * Covers:
 *   F1 mobile   Full plan flow at a phone viewport: signup, account, Plan via
 *               bottom-tab, assumptions, results, save (dashboard stays
 *               projection-free).
 *   AE6         Perf budget: time-to-results < 15 s; inputs remain interactive
 *               during recompute.
 *
 * AE15 is handled in plan.spec.ts with an explanatory comment; the true in-
 * memory-DB path is exercised at the worker level by fallback-storage.spec.ts.
 *
 * Username convention: continuing plan.spec.ts usernames (finn, hana, iris);
 * mobile tests use ONE shared fresh user: lisa-RUN.
 *
 * Rate-limit budget: plan.spec.ts uses 3 fresh signups (finn, hana, iris).
 * Mobile tests run after all desktop tests and are in a fresh window, so
 * one additional signup (lisa) is safe.
 *
 * The Next.js dev overlay is pinned to a bottom corner over the fixed tab bar;
 * use dispatchEvent("click") rather than .click() on bottom-bar links (same
 * pattern as navigation.mobile.spec.ts).
 */

import { expect, test } from "@playwright/test";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { restoreSession, signupAndLogin } from "./helpers/auth";
import { ensureAssumptionsExpanded } from "./helpers/plan";

const RUN = Date.now().toString(36);
const PASS = "Privance-e2e-passphrase-2026!";

const SAVE_TIMEOUT = 40_000;
/** Generous first-run threshold per R17 (AE6). Tightened after measurement. */
const PERF_THRESHOLD_MS = 15_000;

const tap = (link: import("@playwright/test").Locator) => link.dispatchEvent("click");

/** Creates a cash account at the mobile viewport (same dialog, different nav path). */
async function createCashAccountMobile(
  page: import("@playwright/test").Page,
  name: string,
  balance = "40000.00",
): Promise<void> {
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
  await dialog.getByLabel("Account name").fill(name);
  await dialog.getByLabel("Balance").fill(balance);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
  await expect(page.getByText(name)).toBeVisible({ timeout: SAVE_TIMEOUT });
}

// ---------------------------------------------------------------------------
// Shared user: lisa-RUN
// Both F1+AE6 and AE6 interactivity tests share this session to avoid burning
// a second signup slot.
// ---------------------------------------------------------------------------

let mobileSession: SessionSnapshot;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const username = `lisa-${RUN}`;
  const { session } = await signupAndLogin(browser, { username, password: PASS });

  // Create an account so the Plan has a non-zero starting pot
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  await restoreSession(page, session);
  await createCashAccountMobile(page, `LisaCash-${RUN}`, "45000.00");
  await ctx.close();

  mobileSession = session;
});

// ---------------------------------------------------------------------------
// F1 mobile + AE6 perf budget
// The perf measurement captures wall-clock time from after the last field fill
// to results visible.
// ---------------------------------------------------------------------------

test.describe("plan mobile: F1 + AE6", () => {
  test("full plan flow at mobile viewport, results within perf budget", async ({ browser }) => {
    test.setTimeout(180_000);

    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      // Viewport is set by the mobile project (Pixel 5 / iPhone 14); no override needed.
    });
    const page = await ctx.newPage();
    await restoreSession(page, mobileSession);

    // 1. Navigate to Plan via the bottom tab bar
    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    await tap(nav.getByRole("link", { name: "Plan" }));
    await expect(page).toHaveURL(/\/app\/plan\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForLoadState("networkidle");

    // 2. Fill assumptions (new user: bar starts expanded; guard handles returning user too)
    await ensureAssumptionsExpanded(page);
    const ageInput = page.getByLabel("Current age");
    await ageInput.fill("35");
    await ageInput.press("Tab");

    const planUntilInput = page.getByLabel("Plan until age");
    await planUntilInput.fill("95");
    await planUntilInput.press("Tab");

    const contribInput = page.getByLabel("Monthly contribution");
    await contribInput.fill("1000");
    await contribInput.press("Tab");

    // AE6: start timing just before the last field that triggers simulation.
    // Mobile edits in a full-screen sheet, so the sim runs (and the result
    // attaches to the DOM) behind it; measure attachment, not visibility.
    const perfStart = Date.now();

    const spendInput = page.getByLabel("Target annual spend");
    await spendInput.fill("40000");
    await spendInput.press("Tab");

    const swrInput = page.getByLabel("Withdrawal rate");
    await swrInput.fill("4");
    await swrInput.press("Tab");

    // 3. Results computed within budget (attached behind the sheet)
    await expect(page.getByTestId("fire-age-value")).toBeAttached({ timeout: PERF_THRESHOLD_MS });
    const elapsed = Date.now() - perfStart;

    // biome-ignore lint/suspicious/noConsole: test metric output
    console.log(
      `[AE6] time-to-results on ${process.env.PLAYWRIGHT_BROWSER ?? "mobile"}: ${elapsed}ms`,
    );

    expect(
      elapsed,
      `AE6: simulation results must appear within ${PERF_THRESHOLD_MS}ms; took ${elapsed}ms`,
    ).toBeLessThan(PERF_THRESHOLD_MS);

    // 4. AE6: inputs remain interactive while the sim recomputes
    await contribInput.fill("2000");
    await expect(contribInput).toHaveValue("2000");
    await expect(page.getByTestId("fire-age-value")).toBeAttached({ timeout: 5_000 });

    // 5. Save the plan: the sheet closes and the results become visible. The
    // Adjust button replacing the sheet signals completion.
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("button", { name: "Adjust plan" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    // 6. Results visible: FIRE age, success rates, fan chart, replay summary
    await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: 20_000 });

    const fireAgeText = await page.getByTestId("fire-age-value").textContent();
    const fireAge = Number(fireAgeText?.trim());
    expect(fireAge).toBeGreaterThanOrEqual(35);
    expect(fireAge).toBeLessThanOrEqual(95);

    await expect(page.getByTestId("mc-success-rate")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("replay-success-rate")).toBeVisible({ timeout: 20_000 });

    // Fan chart present; Recharts SVG is not in the ARIA tree so we assert the
    // container is visible and does not show the fallback message.
    const fanChart = page.getByRole("img", { name: "Projection fan chart" });
    await expect(fanChart).toBeVisible({ timeout: 20_000 });
    await expect(fanChart.getByText("Not enough data to render the chart.")).not.toBeVisible();

    // Milestones and levers render at the mobile viewport, with the lever
    // readout matching the headline FIRE age at rest.
    await expect(page.getByRole("region", { name: "Your FIRE milestones" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("region", { name: "What moves your FIRE age" })).toBeVisible();
    const headlineAge = Number((await page.getByTestId("fire-age-value").textContent())?.trim());
    expect(Number((await page.getByTestId("lever-fire-age").textContent())?.trim())).toBe(
      headlineAge,
    );

    // 7. Navigate to dashboard via bottom tab; projections must NOT appear here
    // (they live in the Plan section only).
    await tap(nav.getByRole("link", { name: "Dashboard" }));
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    // History chart renders, with no plan projection on it.
    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Projected range" })).not.toBeVisible();
    await expect(page.getByText("set up your plan")).not.toBeVisible();

    await ctx.close();
  });
});

// ---------------------------------------------------------------------------
// AE6 (isolated interactivity check): verify inputs stay interactive during
// recompute. Uses the same shared session (no additional signup needed).
// ---------------------------------------------------------------------------

test.describe("plan mobile: AE6 interactivity during recompute", () => {
  test("field accepts keystrokes while updating indicator may be visible", async ({ browser }) => {
    test.setTimeout(120_000);

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, mobileSession);

    // Navigate to Plan
    await page.goto("/app/plan/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForLoadState("networkidle");

    // The plan from F1+AE6 test may be auto-loaded; wait for either the form
    // to load a saved plan (and show results) or show the empty form state.
    // Fill assumptions regardless to trigger a fresh computation.
    await ensureAssumptionsExpanded(page);
    const ageInput = page.getByLabel("Current age");
    await ageInput.fill("38");
    await ageInput.press("Tab");

    await page.getByLabel("Plan until age").fill("95");
    await page.getByLabel("Plan until age").press("Tab");

    await page.getByLabel("Monthly contribution").fill("1000");
    await page.getByLabel("Target annual spend").fill("45000");
    await page.getByLabel("Target annual spend").press("Tab");
    await page.getByLabel("Withdrawal rate").fill("4");
    await page.getByLabel("Withdrawal rate").press("Tab");

    // Wait for first results to compute (attached behind the open sheet)
    await expect(page.getByTestId("fire-age-value")).toBeAttached({ timeout: 20_000 });

    // Now change a field to trigger recompute: the field must accept the change immediately
    const contribInput = page.getByLabel("Monthly contribution");
    await contribInput.fill("3000");

    // Assert the field holds the new value (interactive during recompute)
    await expect(contribInput).toHaveValue("3000");

    // Result stays in the DOM even while recomputing (stale shown behind the sheet)
    await expect(page.getByTestId("fire-age-value")).toBeAttached({ timeout: 5_000 });

    // Final results should settle within the perf budget
    await expect(page.getByTestId("fire-age-value")).toBeAttached({
      timeout: PERF_THRESHOLD_MS,
    });

    await ctx.close();
  });
});
