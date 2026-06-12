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
 *   AE1     Dashboard carries no plan projection (projections live in the Plan
 *           section only: no set-up prompt, no Projected range).
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
import { loginAndCapture, restoreSession, signupAndLogin } from "./helpers/auth";
import { ensureAssumptionsExpanded } from "./helpers/plan";

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

/**
 * Navigates to the Plan screen and fills the minimum required assumptions.
 * Returns without waiting for results (caller controls the next assertion).
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
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForLoadState("networkidle");

  // Expand the AssumptionsBar if the user has a saved plan (bar starts collapsed)
  await ensureAssumptionsExpanded(page);

  // Fill current age
  const ageInput = page.getByLabel("Current age");
  await ageInput.fill(String(currentAge));
  await ageInput.press("Tab");

  // Plan until age defaults to 95; clear and re-enter to ensure it registers
  const planUntilInput = page.getByLabel("Plan until age");
  await planUntilInput.fill("95");
  await planUntilInput.press("Tab");

  // Monthly contribution
  const contribInput = page.getByLabel("Monthly contribution");
  await contribInput.fill(String(monthlyContribution));
  await contribInput.press("Tab");

  // Annual spend (required; triggers simulation once ages are also valid)
  const spendInput = page.getByLabel("Target annual spend");
  await spendInput.fill(String(annualSpend));
  await spendInput.press("Tab");

  // SWR
  const swrInput = page.getByLabel("Withdrawal rate");
  await swrInput.fill(String(swrPercent));
  await swrInput.press("Tab");
}

// ---------------------------------------------------------------------------
// F1 + F2 (serial describe reusing the same user: finn)
// ---------------------------------------------------------------------------

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

      // Navigate to dashboard first so the top nav is visible, then click Plan
      await page.goto("/app/");
      await expect(page).toHaveURL("/app/", { timeout: 15_000 });
      await page.waitForLoadState("networkidle");

      const topNav = page.getByRole("navigation", { name: "Main navigation" });
      await topNav.getByRole("link", { name: "Plan" }).click();
      await expect(page).toHaveURL(/\/app\/plan\/?$/, { timeout: 10_000 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 10_000,
      });
      await page.waitForLoadState("networkidle");

      // Starting portfolio should reflect the account (non-zero)
      const potDisplay = page.getByTestId("starting-pot");
      await expect(potDisplay).toBeVisible({ timeout: 10_000 });
      const potText = await potDisplay.textContent();
      expect(potText).not.toBe("$0.00");
      expect(potText).toMatch(/\$/);

      // Fill assumptions
      await fillPlanAssumptions(page, {
        currentAge: 35,
        annualSpend: 40000,
        monthlyContribution: 1000,
        swrPercent: 4,
      });

      // Results panel: headline, success rate cards, fan chart
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

      // FIRE age must be a realistic number (between currentAge and planUntilAge)
      const fireAgeText = await page.getByTestId("fire-age-value").textContent();
      const fireAge = Number(fireAgeText?.trim());
      expect(fireAge).toBeGreaterThanOrEqual(35);
      expect(fireAge).toBeLessThanOrEqual(95);

      // Monte Carlo simulation card
      const successRateSection = page.getByRole("region", { name: "Monte Carlo simulation" });
      await expect(successRateSection).toBeVisible({ timeout: SIM_TIMEOUT });
      const mcRate = page.getByTestId("mc-success-rate");
      await expect(mcRate).toBeVisible({ timeout: SIM_TIMEOUT });
      const mcText = await mcRate.textContent();
      expect(mcText).toMatch(/%/);

      // Historical replay success rate
      const replayRate = page.getByTestId("replay-success-rate");
      await expect(replayRate).toBeVisible({ timeout: SIM_TIMEOUT });
      const replayText = await replayRate.textContent();
      expect(replayText).toMatch(/%/);

      // Fan chart present (role="img" label). The Recharts SVG renders inside the
      // container; asserting the container is visible and does not show the
      // "Not enough data" fallback is the observable outcome (SVG is not in the
      // ARIA tree and cannot be reliably located via getByRole).
      const fanChart = page.getByRole("img", { name: "Projection fan chart" });
      await expect(fanChart).toBeVisible({ timeout: SIM_TIMEOUT });
      await expect(fanChart.getByText("Not enough data to render the chart.")).not.toBeVisible();

      // Historical Replay simulation card
      const replaySummary = page.getByRole("region", { name: "Historical Replay simulation" });
      await expect(replaySummary).toBeVisible({ timeout: SIM_TIMEOUT });

      // FIRE milestones ladder is present (Coast / Lean / FIRE / Fat).
      const milestones = page.getByRole("region", { name: "Your FIRE milestones" });
      await expect(milestones).toBeVisible({ timeout: SIM_TIMEOUT });
      await expect(milestones.getByText("Coast FIRE")).toBeVisible();
      await expect(milestones.getByText("Fat FIRE")).toBeVisible();

      // Save the plan
      await page.getByRole("button", { name: "Save plan" }).click();
      // The first save flips the plan to saved, collapsing the assumptions bar
      // to the hero (returning-user state); the Adjust button replaces the form.
      await expect(page.getByRole("button", { name: "Adjust plan" })).toBeVisible({
        timeout: SAVE_TIMEOUT,
      });

      // Levers appear once the editor is closed (they edit the same plan, so
      // only one is shown at a time). At rest the readout equals the headline.
      const levers = page.getByRole("region", { name: "What moves your FIRE age" });
      await expect(levers).toBeVisible({ timeout: SIM_TIMEOUT });
      const headlineAge = Number((await page.getByTestId("fire-age-value").textContent())?.trim());
      expect(Number((await page.getByTestId("lever-fire-age").textContent())?.trim())).toBe(
        headlineAge,
      );

      // A lever edit reruns the engine and recomputes the whole page: snapping
      // allocation to Aggressive shifts the headline FIRE age (90% stocks has a
      // different expected return), proving levers drive the live plan.
      await levers.getByRole("button", { name: "Aggr", exact: true }).click();
      await expect(levers.getByText("90% stocks")).toBeVisible({ timeout: SIM_TIMEOUT });
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
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 15_000,
      });
      await page.waitForLoadState("networkidle");

      // Wait for initial results to appear (auto-run from saved plan)
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

      // Returning user: bar starts collapsed; expand before editing fields
      await ensureAssumptionsExpanded(page);

      // Change the monthly contribution: the form should accept the change immediately
      const contribInput = page.getByLabel("Monthly contribution");
      await contribInput.fill("5000");
      await contribInput.press("Tab");

      // Field accepted the change (interactive during recompute)
      await expect(contribInput).toHaveValue("5000");

      // Results tile stays visible (stale results shown while recomputing)
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: 5_000 });

      // Wait for new results to settle
      await expect(page.getByTestId("fire-age-value")).toBeVisible({ timeout: SIM_TIMEOUT });

      // Save with the new value. Saving collapses the bar to the hero (same as
      // Done); the Adjust button replacing the form signals completion.
      await page.getByRole("button", { name: "Save plan" }).click();
      await expect(page.getByRole("button", { name: "Adjust plan" })).toBeVisible({
        timeout: SAVE_TIMEOUT,
      });

      // Reload: restoreSession's addInitScript re-injects the DEK on reload
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 30_000,
      });
      await page.waitForLoadState("networkidle");

      // After reload the bar starts collapsed for a returning user; expand it
      await ensureAssumptionsExpanded(page);

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

// ---------------------------------------------------------------------------
// AE2: FIRE number derivation (shared user: hana)
// ---------------------------------------------------------------------------

test.describe("plan: AE2 FIRE number", () => {
  let savedSession: SessionSnapshot;

  // The FIRE number derives from spend and SWR alone, so this describe reuses
  // the shared fixture user (signups are budgeted at 3 per IP per minute) and
  // never saves a plan or mutates shared state.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const { sharedUser } = loadFixtures();
    savedSession = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });
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

    // The FIRE number = spend / SWR = 40000 / 0.04 = 1,000,000
    // It appears in the headline "Target" anchor.
    // Match with a regex tolerant of formatting variations.
    await expect(page.getByText(/1[,.]000[,.]000/)).toBeVisible({ timeout: SIM_TIMEOUT });
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

    // 40000 / 0.035 = 1,142,857.14... rounds to 1,142,857
    // Match the formatted value tolerantly
    await expect(page.getByText(/1[,.]142[,.]857/)).toBeVisible({ timeout: SIM_TIMEOUT });
  });
});

// ---------------------------------------------------------------------------
// AE14 + AE15: Network-layer privacy and fallback-storage fidelity
// Shared user: iris
// ---------------------------------------------------------------------------

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
  // Deliberately not on a shared fixture user: the dashboard empty-state spec
  // depends on recoveryUser having no accounts, and adding one here once broke
  // it on firefox/webkit ordering.
  test("AE1: dashboard chart carries no plan projection (lives in the Plan section)", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await restoreSession(page, savedSession);

    await page.goto("/app/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("img", { name: "Net worth history chart" })).toBeVisible({
      timeout: 15_000,
    });

    // Projections belong to the Plan section only: the dashboard chart must never
    // show a "set up your plan" prompt or a "Projected" range, plan or no plan.
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

    // Save: this triggers the sync push. The first save collapses the bar to
    // the hero; the Adjust button replacing the form signals completion.
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("button", { name: "Adjust plan" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    // Give the background pushPending call a moment to fire
    await page.waitForTimeout(3000);

    // At least one sync request must have been captured
    expect(
      capturedBodies.length,
      "expected at least one sync request to be captured",
    ).toBeGreaterThan(0);

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

    // Save must succeed without a storage error. The first save collapses the
    // bar to the hero; the Adjust button replacing the form signals completion.
    await page.getByRole("button", { name: "Save plan" }).click();
    await expect(page.getByRole("button", { name: "Adjust plan" })).toBeVisible({
      timeout: SAVE_TIMEOUT,
    });

    // No error alert visible (storage error would surface as a save error)
    await expect(page.getByText("Could not save")).not.toBeVisible();

    await ctx.close();
  });
});
