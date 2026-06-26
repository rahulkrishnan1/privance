/**
 * FIRE plan E2E suite: desktop (chromium, firefox, webkit).
 *
 * Covers:
 *   F1      First-time setup: signup, account, Plan tab, assumptions, results,
 *           save.
 *   F2      Edit + reload: changing an input updates results; reload restores
 *           saved assumptions.
 *   AE2     FIRE number: spend $40k + 4% SWR shows $1,000,000; 3.5% shows
 *           $1,142,857.
 *   AE1     Invest screen carries no plan projection (projections live in the
 *           Plan section only: no set-up prompt, no Projected range).
 *   AE14    Network-layer privacy: no sync request body contains any plan
 *           payload field name or plaintext value.
 *   AE15    Fallback-storage: plan creation and rendering on OPFS-enabled
 *           baseline (true in-memory path covered by fallback-storage.spec.ts).
 *
 * Rate-limit budget (3 signups per IP per minute): this file burns exactly two
 * fresh signups per project:
 *   finn    F1 + F2 (serial describe)
 *   iris    AE1 + AE14 + AE15 (one beforeAll; AE1 runs first, before any plan
 *           is saved on iris)
 * AE2 reuses the shared fixture user (never saves, never mutates). Never add
 * accounts to recoveryUser here: the dashboard empty-state spec depends on it
 * having none. Signups queue through submitSignup's rate-limit retry, so
 * parallel projects self-space across budget windows.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { loginAndCapture, restoreSession, signupAndLogin, waitForSynced } from "./helpers/auth";
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
  await dialog.getByRole("button", { name: "Cash" }).click();
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
      await expect(page).toHaveURL("/app/", { timeout: 15_000 });
      // Wait for the account to finish syncing so the plan's account-derived pot
      // is computed (otherwise the starting pot reads $0).
      await waitForSynced(page);

      const topNav = page.getByRole("navigation", { name: "Primary navigation" });
      await topNav.getByRole("link", { name: "Plan" }).click();
      await expect(page).toHaveURL(/\/app\/plan\/?$/, { timeout: 10_000 });
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
      const method = page.getByRole("group", { name: "Projection method" });
      await expect(method).toBeVisible({ timeout: SIM_TIMEOUT });

      await method.getByRole("button", { name: "Monte Carlo" }).click();
      const mcRate = page.getByTestId("confidence-rate");
      await expect(mcRate).toBeVisible({ timeout: SIM_TIMEOUT });
      const mcPct = Number((await mcRate.textContent())?.replace(/[^0-9.]/g, ""));
      expect(mcPct).toBeGreaterThanOrEqual(1);
      expect(mcPct).toBeLessThanOrEqual(100);

      await method.getByRole("button", { name: "Historical replay" }).click();
      const replayRate = page.getByTestId("confidence-rate");
      await expect(replayRate).toBeVisible({ timeout: SIM_TIMEOUT });
      const replayPct = Number((await replayRate.textContent())?.replace(/[^0-9.]/g, ""));
      expect(replayPct).toBeGreaterThanOrEqual(1);
      expect(replayPct).toBeLessThanOrEqual(100);

      // Fan chart present (role="img" label). The Recharts SVG renders inside the
      // container; asserting the container is visible and does not show the
      // "Not enough data" fallback is the observable outcome (SVG is not in the
      // ARIA tree and cannot be reliably located via getByRole).
      const fanChart = page.getByRole("img", { name: "Projection fan chart" });
      await expect(fanChart).toBeVisible({ timeout: SIM_TIMEOUT });
      await expect(fanChart.getByText("Not enough data to render the chart.")).not.toBeVisible();

      // Milestones ladder is present (Coast FI / Lean FI / FI / Fat FI).
      const milestones = page.getByRole("heading", { name: "Milestones" });
      await expect(milestones).toBeVisible({ timeout: SIM_TIMEOUT });
      await expect(page.getByText(/Coast FI/)).toBeVisible();
      await expect(page.getByText(/Fat FI/)).toBeVisible();

      // Save the plan. The panel stays visible; the save control flips from
      // "Save plan" to "Plan saved" once the plan is persisted and clean.
      await page.getByRole("button", { name: "Save plan" }).click();
      await expect(page.getByRole("button", { name: "Plan saved" })).toBeVisible({
        timeout: SAVE_TIMEOUT,
      });

      // A lever edit reruns the engine and recomputes the whole page: snapping
      // allocation to the most aggressive mix shifts the headline FIRE age
      // (more stocks change the expected return), proving levers drive the
      // live plan.
      const headlineAge = Number((await page.getByTestId("fire-age-value").textContent())?.trim());
      await page.getByRole("button", { name: "Aggressive" }).click();
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
      // Wait for the saved plan to finish syncing before touching the panel, or a
      // late load re-initialises the Adjust panel and discards the slider change.
      await waitForSynced(page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 15_000,
      });

      // Wait for initial results to appear (auto-run from saved plan)
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

      // The Adjust panel is always visible. Change the monthly contribution
      // slider: the change must register immediately.
      const contribInput = page.getByLabel("Monthly contribution");
      await setSlider(contribInput, 5000);

      // Slider accepted the change (interactive during recompute)
      await expect(contribInput).toHaveValue("5000");

      // Results tile stays visible (stale results shown while recomputing)
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: 5_000 });

      // Wait for new results to settle
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

      // Save with the new value. The panel stays visible; the save control
      // flipping to "Plan saved" signals completion.
      await page.getByRole("button", { name: "Save plan" }).click();
      await expect(page.getByRole("button", { name: "Plan saved" })).toBeVisible({
        timeout: SAVE_TIMEOUT,
      });

      // Reload: restoreSession's addInitScript re-injects the DEK on reload
      await page.reload();
      await waitForSynced(page);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 30_000,
      });

      // Saved assumptions must be restored: current age = 35 (set in F1)
      const ageInput = page.getByLabel("Current age");
      await expect(ageInput).toHaveValue("35", { timeout: 15_000 });

      // Annual spend = 40000 (set in F1)
      const spendInput = page.getByLabel("Target annual spend");
      await expect(spendInput).toHaveValue("40000", { timeout: 10_000 });

      // Monthly contribution = 5000 (saved in this test)
      const reloadedContrib = page.getByLabel("Monthly contribution");
      await expect(reloadedContrib).toHaveValue("5000", { timeout: 10_000 });

      // Simulation runs automatically from the loaded plan
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });
    });
  });

test.describe("plan: AE2 FIRE number", () => {
  let savedSession: SessionSnapshot;

  // The FIRE number derives from spend and SWR alone, so this describe reuses
  // the shared fixture user (signups are budgeted at 3 per IP per minute). An
  // account is required to reach the Plan adjust panel; its balance does not
  // affect the FIRE number.
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

    // The FI number = spend / SWR = 40000 / 0.04 = 1,000,000. It renders in the
    // headline "FI number" readout. The slider commits asynchronously, so poll.
    const fireNumber = page.getByTestId("fire-number");
    await expect(async () => {
      expect((await fireNumber.textContent())?.trim()).toMatch(/1[,.]000[,.]000/);
    }).toPass({ timeout: SIM_TIMEOUT });
  });

  test("switching SWR to 3.5% updates FIRE number to ~$1,142,857", async ({ page }) => {
    test.setTimeout(120_000);

    await fillPlanAssumptions(page, {
      currentAge: 30,
      annualSpend: 40000,
      monthlyContribution: 500,
      swrPercent: 3.5,
    });

    await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

    // 40000 / 0.035 = 1,142,857.14... rounds to $1,142,857 in the FI number.
    const fireNumber = page.getByTestId("fire-number");
    await expect(async () => {
      expect((await fireNumber.textContent())?.trim()).toMatch(/1[,.]142[,.]857/);
    }).toPass({ timeout: SIM_TIMEOUT });
  });
});

/**
 * Plan payload field names as defined in packages/core/src/domain/plan.ts.
 * These strings must never appear in any sync request body in plaintext.
 *
 * Source: packages/core/src/domain/plan.ts: PlanPayloadBase + PlanPayloadCustom
 */
const PLAN_PAYLOAD_FIELD_NAMES = [
  "schemaVersion",
  "currentAge",
  "planUntilAge",
  "monthlyContributionCents",
  "annualSpendCents",
  "swrBps",
  "preset",
  "muBps",
  "sigmaBps",
  "stockWeightBps",
  "seed",
] as const;

test.describe("plan: AE1 + AE14 + AE15", () => {
  let savedSession: SessionSnapshot;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const username = `iris-${RUN}`;
    const { session } = await signupAndLogin(browser, { username, password: PASS });

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, session);
    await createCashAccount(page, `IrisCash-${RUN}`, "20000.00");
    await ctx.close();

    savedSession = session;
  });

  // Runs FIRST in this describe, while iris has an account but no saved plan.
  // Deliberately not on a shared fixture user: the empty-state spec depends on
  // recoveryUser having no accounts, and adding one here once broke it on
  // firefox/webkit ordering.
  test("AE1: Invest screen carries no plan projection (lives in the Plan section)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await restoreSession(page, savedSession);

    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    await waitForSynced(page);

    // The Invest screen is the app's primary screen: net-worth hero + history chart.
    await expect(page.getByTestId("invest-net-worth")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible({
      timeout: 15_000,
    });

    // Projections belong to the Plan section only: the Invest net-worth chart
    // must never show a "set up your plan" prompt or a "Projected" range,
    // plan or no plan.
    await expect(page.getByText("set up your plan")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Projected range" })).not.toBeVisible();
  });

  test("AE14: plan save sends only ciphertext-shaped bodies; no field names or values leak", async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, savedSession);

    // Collect all request bodies sent to the sync server during the plan-save
    const capturedBodies: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      // Intercept sync API calls (api/sync/batch and api/sync/objects/*)
      if (url.includes("/api/sync/")) {
        const body = req.postData();
        if (body !== null && body.length > 0) {
          capturedBodies.push(body);
        }
      }
    });

    // Fill and save the plan with known values we can check for
    const knownSpend = 40000;
    const knownSwr = 4;

    await fillPlanAssumptions(page, {
      currentAge: 35,
      annualSpend: knownSpend,
      monthlyContribution: 1500,
      swrPercent: knownSwr,
    });

    await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

    // Save: this triggers the sync push. The save control flipping to
    // "Plan saved" signals the save completed.
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("button", { name: "Plan saved" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    // Wait for the background pushPending call to actually fire, rather than a
    // fixed sleep, so the privacy assertions below always run against a real
    // captured body instead of passing vacuously if the push is slow.
    await expect
      .poll(() => capturedBodies.length, {
        message: "expected at least one sync request to be captured",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);

    for (const body of capturedBodies) {
      // (a) Assert each body does NOT contain any plan payload field name
      for (const fieldName of PLAN_PAYLOAD_FIELD_NAMES) {
        expect(
          body,
          `Sync request body must not contain the plaintext field name "${fieldName}"`,
        ).not.toContain(fieldName);
      }

      // (b) Assert the body does not contain any plaintext entered values.
      // annualSpendCents as string would be "4000000" (40000 dollars * 100)
      const spendCentsStr = String(knownSpend * 100);
      expect(
        body,
        `Sync request body must not contain the spend cents value "${spendCentsStr}"`,
      ).not.toContain(spendCentsStr);

      // (c) Confirm the body has ciphertext-shaped content (base64url or base64 characters).
      // Sync wire format wraps items in JSON with ciphertext/nonce as base64 strings.
      expect(
        body.includes("ciphertext") || body.includes("nonce"),
        `Sync request body must include encrypted fields (ciphertext/nonce) but got: ${body.slice(0, 200)}`,
      ).toBe(true);
    }

    await ctx.close();
  });

  test("AE15: plan creation and rendering completes without storage errors", async ({
    browser,
  }) => {
    // AE15 fidelity note: on chromium this runs against OPFS as the baseline.
    // On the webkit desktop project the same test IS the fallback test: plain
    // newContext() is ephemeral there, OPFS getDirectory() fails (same as
    // Safari Private Browsing), and the app falls back to the in-memory DB,
    // so plan creation and rendering complete on the fallback-storage host.
    //
    // Own fresh user (not shared iris): this asserts a genuine first-time plan
    // CREATION. Sharing iris with AE14 would make this a second save on the
    // same singleton plan from a separate context, which conflicts.
    test.setTimeout(300_000);

    const username = `ivy-${RUN}`;
    const { session } = await signupAndLogin(browser, { username, password: PASS });
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, session);
    await createCashAccount(page, `IvyCash-${RUN}`, "20000.00");

    await fillPlanAssumptions(page, {
      currentAge: 32,
      annualSpend: 35000,
      monthlyContribution: 800,
      swrPercent: 4,
    });

    // Results must appear
    await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

    // Save must succeed without a storage error. The save control flipping to
    // "Plan saved" signals the save completed.
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("button", { name: "Plan saved" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    // No error alert visible (storage error would surface as a save error)
    await expect(page.getByText("Could not save")).not.toBeVisible();

    await ctx.close();
  });
});
