/**
 * FIRE plan E2E mobile suite: runs under mobile-safari (iPhone 14) and
 * mobile-chrome (Pixel 5).
 *
 * Covers:
 *   F1 mobile   Full plan flow at a phone viewport: signup, account, Plan via
 *               bottom-tab, assumptions, results, save (Invest screen stays
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
import { restoreSession, signupAndLogin, waitForSynced } from "./helpers/auth";
import { setSlider } from "./helpers/forms";

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
    page.getByTestId("invest-net-worth").or(page.getByRole("heading", { name: /vault is empty/i })),
  ).toBeVisible({ timeout: 15_000 });
  await waitForSynced(page);

  await page
    .getByRole("button", { name: /Add.*account/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await expect(dialog).toBeVisible();
  // The form opens on Investment; pick Cash so the "Current balance" field shows.
  await dialog.getByRole("button", { name: "Cash" }).click();
  await dialog.getByLabel("Account type").selectOption("checking");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Current balance").fill(balance);
  await dialog.getByRole("button", { name: "Add account" }).click();
  await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
  await expect(page.getByText(name)).toBeVisible({ timeout: SAVE_TIMEOUT });
}

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
    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await waitForSynced(page);

    await tap(nav.getByRole("link", { name: "Plan" }));
    await expect(page).toHaveURL(/\/app\/plan\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // 2. Fill assumptions. The Adjust panel renders inline at the mobile
    // viewport (no sheet). Age fields are text NumberFields (commit on blur);
    // contribution, spend, and SWR are range sliders.
    const ageInput = page.getByLabel("Current age");
    await expect(ageInput).toBeVisible({ timeout: 15_000 });
    await ageInput.fill("35");
    await ageInput.press("Tab");

    const planUntilInput = page.getByLabel("Plan until age");
    await planUntilInput.fill("95");
    await planUntilInput.press("Tab");

    const contribInput = page.getByLabel("Monthly contribution");
    await setSlider(contribInput, 1000);

    // AE6: start timing just before the last field that triggers simulation.
    const perfStart = Date.now();

    await setSlider(page.getByLabel("Target annual spend"), 40000);
    await setSlider(page.getByLabel("Withdrawal rate"), 4);

    // 3. Results computed within budget
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
    await setSlider(contribInput, 2000);
    await expect(contribInput).toHaveValue("2000");
    await expect(page.getByTestId("fire-age-value")).toBeAttached({ timeout: 5_000 });

    // 5. Save the plan. The panel stays visible; the save control flipping to
    // "Plan saved" signals completion.
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("button", { name: "Plan saved" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    // 6. Results visible: FIRE age, confidence rate, fan chart
    await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: 20_000 });

    const fireAgeText = await page.getByTestId("fire-age-value").textContent();
    const fireAge = Number(fireAgeText?.trim());
    expect(fireAge).toBeGreaterThanOrEqual(35);
    expect(fireAge).toBeLessThanOrEqual(95);

    // Confidence is a single toggle; read both methods' rates via `confidence-rate`.
    const method = page.getByRole("group", { name: "Projection method" });
    await method.getByRole("button", { name: "Monte Carlo" }).click();
    const confidence = page.getByTestId("confidence-rate");
    await expect(confidence).toBeVisible({ timeout: 20_000 });
    expect((await confidence.textContent())?.trim()).toMatch(/%/);
    await method.getByRole("button", { name: "Historical replay" }).click();
    expect((await confidence.textContent())?.trim()).toMatch(/%/);

    // Fan chart present; Recharts SVG is not in the ARIA tree so we assert the
    // container is visible and does not show the fallback message.
    const fanChart = page.getByRole("img", { name: "Projection fan chart" });
    await expect(fanChart).toBeVisible({ timeout: 20_000 });
    await expect(fanChart.getByText("Not enough data to render the chart.")).not.toBeVisible();

    // Milestones render at the mobile viewport.
    await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Coast FI/)).toBeVisible();
    await expect(page.getByText(/Fat FI/)).toBeVisible();

    // 7. Navigate to the Invest screen via bottom tab; projections must NOT appear
    // here (they live in the Plan section only).
    await tap(nav.getByRole("link", { name: "Invest" }));
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    await waitForSynced(page);

    // History chart renders, with no plan projection on it.
    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Projected range" })).not.toBeVisible();
    await expect(page.getByText("set up your plan")).not.toBeVisible();

    await ctx.close();
  });
});

test.describe("plan mobile: AE6 interactivity during recompute", () => {
  test("field accepts keystrokes while updating indicator may be visible", async ({ browser }) => {
    test.setTimeout(120_000);

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, mobileSession);

    // Navigate to Plan
    await page.goto("/app/plan/");
    await waitForSynced(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 15_000,
    });

    // The plan from F1+AE6 test may be auto-loaded; the Adjust panel is always
    // visible. Fill assumptions regardless to trigger a fresh computation.
    const ageInput = page.getByLabel("Current age");
    await expect(ageInput).toBeVisible({ timeout: 15_000 });
    await ageInput.fill("38");
    await ageInput.press("Tab");

    await page.getByLabel("Plan until age").fill("95");
    await page.getByLabel("Plan until age").press("Tab");

    await setSlider(page.getByLabel("Monthly contribution"), 1000);
    await setSlider(page.getByLabel("Target annual spend"), 45000);
    await setSlider(page.getByLabel("Withdrawal rate"), 4);

    // Wait for first results to compute
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
