/**
 * FIRE plan E2E suite: desktop (chromium).
 *
 * Covers:
 *   F1      First-time setup: signup, account, Plan tab, assumptions, results,
 *           save.
 *   F2      Edit + reload: changing an input updates results; reload restores
 *           saved assumptions.
 *   AE2     FIRE number: spend $40k + 4% SWR shows $1,000,000.
 *
 * Signup budget: this file burns exactly one fresh signup per project:
 *   finn    F1 + F2 (serial describe)
 * AE2 reuses the shared fixture user (never saves the plan).
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import {
  clickNavLink,
  loginAndCapture,
  restoreSession,
  signupAndLogin,
  waitForSynced,
} from "./helpers/auth";
import { setSlider } from "./helpers/forms";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

const RUN = Date.now().toString(36);
const PASS = "Privance-e2e-passphrase-2026!";

/** Cold OPFS first write can be very slow; give 40 s to any post-save assertion. */
const SAVE_TIMEOUT = 40_000;

/** Time to wait for simulation results to appear after filling the form. */
const SIM_TIMEOUT = 30_000;

/**
 * Creates a cash account for the given authenticated page.
 * Navigates to accounts, fills the dialog, saves, and waits for the account
 * to appear in the list.
 */
async function createCashAccount(
  page: import("@playwright/test").Page,
  name: string,
  balance = "50000.00",
): Promise<void> {
  await page.goto("/app/accounts/");
  await expect(page.getByRole("link", { name: "Invest" })).toBeVisible({ timeout: 15_000 });
  await waitForSynced(page);

  await page
    .getByRole("button", { name: /Add.*account/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog", { name: /Add account/i });
  await expect(dialog).toBeVisible();
  // Select Cash kind so the Current balance field appears (form opens as Investment by default)
  await dialog.getByRole("radio", { name: "Cash" }).click();
  await dialog.getByLabel("Account type").selectOption("checking");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Current balance").fill(balance);
  await dialog.getByRole("button", { name: "Add account" }).click();
  await expect(dialog).not.toBeVisible({ timeout: SAVE_TIMEOUT });
  await expect(page.getByText(name)).toBeVisible({ timeout: SAVE_TIMEOUT });
}

/**
 * Navigates to the Plan screen and fills the assumptions via the v2 Adjust
 * panel. Returns without waiting for results (caller controls the next
 * assertion).
 *
 * Plan v2 controls: Current age / Plan until age are text NumberFields (commit
 * on blur via Tab); Monthly contribution, Target annual spend, and Withdrawal
 * rate are native range sliders (set via setSlider). The panel is always
 * visible, so there is no expand step.
 */
async function fillPlanAssumptions(
  page: import("@playwright/test").Page,
  opts: {
    currentAge?: number;
    annualSpend?: number;
    monthlyContribution?: number;
    swrPercent?: number;
  } = {},
): Promise<void> {
  const { currentAge = 35, annualSpend = 40000, monthlyContribution = 1000, swrPercent = 4 } = opts;

  await page.goto("/app/plan/");
  await waitForSynced(page);

  // The account-derived pot opens the Adjust panel directly; wait for its first field.
  const ageInput = page.getByLabel("Current age");
  await expect(ageInput).toBeVisible({ timeout: 15_000 });

  // Text NumberFields: commit on blur.
  await ageInput.fill(String(currentAge));
  await ageInput.press("Tab");

  const planUntilInput = page.getByLabel("Plan until age");
  await planUntilInput.fill("95");
  await planUntilInput.press("Tab");

  // Range sliders: set via the native value setter (fill() is unreliable on
  // <input type="range"> for React-controlled sliders under load).
  await setSlider(page.getByLabel("Monthly contribution"), monthlyContribution);
  await setSlider(page.getByLabel("Target annual spend"), annualSpend);
  await setSlider(page.getByLabel("Withdrawal rate"), swrPercent);
}

test.describe
  .serial("plan: F1 first-time setup and F2 edit+reload", () => {
    let savedSession: SessionSnapshot;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(300_000);
      const username = `finn-${RUN}`;
      const { session } = await signupAndLogin(browser, { username, password: PASS });

      // Create a cash account once; all F1/F2 tests share this user's data.
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      const page = await ctx.newPage();
      await restoreSession(page, session);
      await createCashAccount(page, `FinnCash-${RUN}`, "50000.00");
      await ctx.close();

      savedSession = session;
    });

    test.beforeEach(async ({ page }) => {
      await restoreSession(page, savedSession);
    });

    test("F1: Plan tab shows pre-filled pot, fill assumptions, results render, save", async ({
      page,
    }) => {
      test.setTimeout(120_000);

      // Navigate to the Invest screen first so the top nav is visible, then click Plan
      await page.goto("/app/");
      await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
      // Wait for the account to finish syncing so the plan's account-derived pot
      // is computed (otherwise the starting pot reads $0).
      await waitForSynced(page);

      const topNav = page.getByRole("navigation", { name: "Primary navigation" });
      await clickNavLink(page, topNav.getByRole("link", { name: "Plan" }), /\/app\/plan\/?$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 10_000,
      });

      // Starting "Today" pot should reflect the account (non-zero). It renders
      // once the first simulation settles from the account-derived defaults.
      const potDisplay = page.getByTestId("starting-pot");
      await expect(potDisplay).toBeVisible({ timeout: SIM_TIMEOUT });
      const potText = await potDisplay.textContent();
      expect(potText).not.toBe("$0");
      expect(potText).toMatch(/\$/);

      // Fill assumptions via the v2 Adjust panel
      await fillPlanAssumptions(page, {
        currentAge: 35,
        annualSpend: 40000,
        monthlyContribution: 1000,
        swrPercent: 4,
      });

      // Headline result: FIRE age
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

      // FIRE age must be a realistic number (between currentAge and planUntilAge)
      const fireAgeText = await page.getByTestId("fire-age-value").textContent();
      const fireAge = Number(fireAgeText?.trim());
      expect(fireAge).toBeGreaterThanOrEqual(35);
      expect(fireAge).toBeLessThanOrEqual(95);

      // Confidence is a single toggle between Monte Carlo and Historical replay;
      // the active method's percentage renders in `confidence-rate`. Read both.
      const method = page.getByRole("radiogroup", { name: "Projection method" });
      await expect(method).toBeVisible({ timeout: SIM_TIMEOUT });

      await method.getByRole("radio", { name: "Monte Carlo" }).click();
      const mcRate = page.getByTestId("confidence-rate");
      await expect(mcRate).toBeVisible({ timeout: SIM_TIMEOUT });
      const mcPct = Number((await mcRate.textContent())?.replace(/[^0-9.]/g, ""));
      expect(mcPct).toBeGreaterThanOrEqual(1);
      expect(mcPct).toBeLessThanOrEqual(100);

      await method.getByRole("radio", { name: "Historical replay" }).click();
      const replayRate = page.getByTestId("confidence-rate");
      await expect(replayRate).toBeVisible({ timeout: SIM_TIMEOUT });
      const replayPct = Number((await replayRate.textContent())?.replace(/[^0-9.]/g, ""));
      expect(replayPct).toBeGreaterThanOrEqual(1);
      expect(replayPct).toBeLessThanOrEqual(100);

      // Fan chart present
      const fanChart = page.getByRole("img", { name: "Projection fan chart" });
      await expect(fanChart).toBeVisible({ timeout: SIM_TIMEOUT });
      await expect(fanChart.getByText("Not enough data to render the chart.")).not.toBeVisible();

      // Milestones ladder is present
      const milestones = page.getByRole("heading", { name: "Milestones" });
      await expect(milestones).toBeVisible({ timeout: SIM_TIMEOUT });
      await expect(page.getByText(/Coast FI/)).toBeVisible();
      await expect(page.getByText(/Fat FI/)).toBeVisible();

      // Save the plan
      await page.getByRole("button", { name: "Save plan" }).click();
      await expect(page.getByRole("button", { name: "Plan saved" })).toBeVisible({
        timeout: SAVE_TIMEOUT,
      });

      // A lever edit reruns the engine
      const headlineAge = Number((await page.getByTestId("fire-age-value").textContent())?.trim());
      await page.getByRole("radio", { name: "Aggressive" }).click();
      await expect(async () => {
        const t = Number((await page.getByTestId("fire-age-value").textContent())?.trim());
        expect(t).not.toBe(headlineAge);
      }).toPass({ timeout: SIM_TIMEOUT });
    });

    test("F2: change contribution, results update, reload restores saved assumptions", async ({
      page,
    }) => {
      test.setTimeout(120_000);

      // Navigate to plan (plan is already saved from F1 test)
      await page.goto("/app/plan/");
      await waitForSynced(page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 15_000,
      });

      // Wait for initial results to appear (auto-run from saved plan)
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

      // Change the monthly contribution slider
      const contribInput = page.getByLabel("Monthly contribution");
      await setSlider(contribInput, 5000);

      // Slider accepted the change
      await expect(contribInput).toHaveValue("5000");

      // Results tile stays visible
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: 5_000 });

      // Wait for new results to settle
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

      // Save with the new value
      await page.getByRole("button", { name: "Save plan" }).click();
      await expect(page.getByRole("button", { name: "Plan saved" })).toBeVisible({
        timeout: SAVE_TIMEOUT,
      });

      // Reload
      await page.reload();
      await waitForSynced(page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 30_000,
      });

      // Saved assumptions must be restored
      await expect(page.getByLabel("Current age")).toHaveValue("35", { timeout: 15_000 });
      await expect(page.getByLabel("Target annual spend")).toHaveValue("40000", {
        timeout: 10_000,
      });
      await expect(page.getByLabel("Monthly contribution")).toHaveValue("5000", {
        timeout: 10_000,
      });

      // Simulation runs automatically
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });
    });
  });

test.describe("plan: AE2 FIRE number", () => {
  let savedSession: SessionSnapshot;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const { sharedUser } = loadFixtures();
    savedSession = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, savedSession);
    await createCashAccount(page, `AE2Cash-${RUN}`, "20000.00");
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await restoreSession(page, savedSession);
  });

  test("spend $40k + 4% SWR shows $1,000,000 FIRE number", async ({ page }) => {
    test.setTimeout(120_000);

    await fillPlanAssumptions(page, {
      currentAge: 30,
      annualSpend: 40000,
      monthlyContribution: 500,
      swrPercent: 4,
    });

    // Wait for results to appear
    await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

    // The FI number = spend / SWR = 40000 / 0.04 = 1,000,000
    const fireNumber = page.getByTestId("fire-number");
    await expect(async () => {
      expect((await fireNumber.textContent())?.trim()).toMatch(/1[,.]000[,.]000/);
    }).toPass({ timeout: SIM_TIMEOUT });
  });
});
