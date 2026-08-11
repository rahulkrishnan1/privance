/**
 * FIRE plan E2E mobile suite: runs under mobile-safari (iPhone 14) and
 * mobile-chrome (Pixel 5).
 *
 * Covers:
 *   F1 mobile   Full plan flow at a phone viewport: signup, account, Plan via
 *               bottom-tab, assumptions, results, save (Invest screen stays
 *               projection-free) + AE6 perf budget.
 *
 * Username: lisa-RUN (one fresh signup for both mobile projects).
 */

import { expect, test } from "@playwright/test";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { restoreSession, signupAndLogin, tapNav, waitForSynced } from "./helpers/auth";
import { setSlider } from "./helpers/forms";

const RUN = Date.now().toString(36);
const PASS = "Privance-e2e-passphrase-2026!";

const SAVE_TIMEOUT = 40_000;
/** Generous first-run threshold per R17 (AE6). */
const PERF_THRESHOLD_MS = 15_000;

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
  await dialog.getByRole("radio", { name: "Cash" }).click();
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

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, mobileSession);

    // 1. Navigate to Plan via the bottom tab bar
    await page.goto("/app/");
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await waitForSynced(page);

    await tapNav(nav.getByRole("link", { name: "Plan" }));
    await expect(page).toHaveURL(/\/app\/plan\/?$/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });

    // 2. Fill assumptions
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

    // 4. Inputs remain interactive while the sim recomputes
    await setSlider(contribInput, 2000);
    await expect(contribInput).toHaveValue("2000");
    await expect(page.getByTestId("fire-age-value")).toBeAttached({ timeout: 5_000 });

    // 5. Save the plan
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("button", { name: "Plan saved" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    // 6. Results visible: FIRE age, confidence rate, fan chart, milestones
    await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: 20_000 });

    const fireAgeText = await page.getByTestId("fire-age-value").textContent();
    const fireAge = Number(fireAgeText?.trim());
    expect(fireAge).toBeGreaterThanOrEqual(35);
    expect(fireAge).toBeLessThanOrEqual(95);

    // Confidence toggle
    const method = page.getByRole("radiogroup", { name: "Projection method" });
    await method.getByRole("radio", { name: "Monte Carlo" }).click();
    const confidence = page.getByTestId("confidence-rate");
    await expect(confidence).toBeVisible({ timeout: 20_000 });
    expect((await confidence.textContent())?.trim()).toMatch(/%/);

    // Fan chart present
    const fanChart = page.getByRole("img", { name: "Projection fan chart" });
    await expect(fanChart).toBeVisible({ timeout: 20_000 });
    await expect(fanChart.getByText("Not enough data to render the chart.")).not.toBeVisible();

    // Milestones render
    await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Coast FI/)).toBeVisible();
    await expect(page.getByText(/Fat FI/)).toBeVisible();

    // 7. Invest screen is projection-free
    await tapNav(nav.getByRole("link", { name: "Invest" }));
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    await waitForSynced(page);

    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Projected range" })).not.toBeVisible();
    await expect(page.getByText("set up your plan")).not.toBeVisible();

    await ctx.close();
  });
});
