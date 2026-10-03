/**
 * Spend on the mobile UI.
 *
 * Mirrors the core of the desktop spend flow at a phone viewport, where the hero,
 * split cards, and the two panels collapse to a single column. Verifies the
 * user-observable outcomes: an added item shows up in its panel, the headline
 * total counts the monthly equivalent, and a non-monthly cadence reads correctly.
 *
 * Matches *.mobile.spec.ts, so it runs under the mobile projects (iPhone /
 * Pixel 5). Uses a fresh per-run user so the empty state is deterministic.
 */

import { expect, test } from "@playwright/test";
import { BASE_URL } from "../../playwright/ports";
import type { SessionSnapshot } from "./helpers/auth";
import { restoreSession, signupAndLogin } from "./helpers/auth";

const PASS = "Privance-e2e-passphrase-2026!";
const RUN = Date.now().toString(36);

let session: SessionSnapshot;

test.beforeAll(async ({ browser }) => {
  const result = await signupAndLogin(browser, {
    username: `grace-${RUN}`,
    password: PASS,
  });
  session = result.session;
});

test.describe("spend mobile", () => {
  test("empty state, add monthly + yearly at a phone viewport", async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, session);

    await page.goto("/app/spend/");
    await expect(page).toHaveURL(/\/app\/spend/, { timeout: 15_000 });

    // Empty state.
    const emptyCta = page.getByRole("button", { name: "Add a recurring expense" });
    await expect(emptyCta).toBeVisible({ timeout: 15_000 });

    // Add a monthly Rent of $1,450 (housing).
    await emptyCta.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add expense" })).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByLabel("Amount").fill("1450");
    await dialog.getByLabel("Interval unit").selectOption("month");
    await dialog.getByLabel("Name").fill("Rent");
    await dialog.getByLabel("Category").selectOption("housing");
    await dialog.getByRole("button", { name: "Add expense", exact: true }).click();

    const rentRow = page.getByRole("button", { name: /Rent/ });
    await expect(rentRow).toBeVisible({ timeout: 10_000 });
    await expect(rentRow).toContainText("$1,450");
    await expect(page.getByTestId("spend-monthly-total")).toContainText("$1,450");

    // Add a yearly Prime of $139 (shopping); the row reads its cadence and the
    // headline counts the monthly equivalent ($1,450 + $11.58 -> $1,462).
    await page.getByRole("button", { name: "+ Add expense" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Add expense" })).toBeVisible({
      timeout: 5_000,
    });
    await dialog.getByLabel("Amount").fill("139");
    await dialog.getByLabel("Interval unit").selectOption("year");
    await dialog.getByLabel("Name").fill("Prime");
    await dialog.getByLabel("Category").selectOption("shopping");
    await dialog.getByRole("button", { name: "Add expense", exact: true }).click();

    const primeRow = page.getByRole("button", { name: /Prime/ });
    await expect(primeRow).toBeVisible({ timeout: 10_000 });
    await expect(primeRow).toContainText("$11.58");
    await expect(page.getByTestId("spend-monthly-total")).toContainText("$1,462");

    for (const expense of [
      { name: "Insurance", amount: "250", category: "insurance" },
      { name: "Streaming", amount: "20", category: "streaming" },
    ]) {
      await page.getByRole("button", { name: "+ Add expense" }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("Amount").fill(expense.amount);
      await dialog.getByLabel("Interval unit").selectOption("month");
      await dialog.getByLabel("Name").fill(expense.name);
      await dialog.getByLabel("Category").selectOption(expense.category);
      await dialog.getByRole("button", { name: "Add expense", exact: true }).click();
      await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    }

    // At the narrowest supported viewport, category labels must remain fully
    // readable rather than being squeezed between amount, share, and disclosure.
    await page.setViewportSize({ width: 320, height: 760 });
    const labelWidths = await Promise.all(
      ["Housing", "Insurance", "Streaming"].map(async (label) => {
        const text = page
          .locator("button[aria-controls^='category-details-']")
          .filter({ hasText: label })
          .getByText(label, { exact: true });
        const { clientWidth, scrollWidth } = await text.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        return { label, clientWidth, clipped: scrollWidth > clientWidth };
      }),
    );
    expect(labelWidths.every(({ clientWidth, clipped }) => clientWidth > 0 && !clipped)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });

    await rentRow.click();
    const details = page.getByRole("dialog", { name: "Rent" });
    await expect(details).toBeVisible();
    const bounds = await details.boundingBox();
    if (!bounds) throw new Error("expense details sheet has no layout bounds");
    await page.evaluate(
      ({ x, startY, endY }) => {
        const target = document.elementFromPoint(x, startY);
        if (!target) throw new Error("could not find the sheet swipe target");
        const touchAt = (clientY: number) => ({
          identifier: 1,
          target,
          clientX: x,
          clientY,
          screenX: x,
          screenY: clientY,
          pageX: x,
          pageY: clientY,
        });
        const dispatchTouch = (type: string, touches: object[], changed: object[]) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: touches },
            targetTouches: { value: touches },
            changedTouches: { value: changed },
          });
          target.dispatchEvent(event);
        };
        const start = touchAt(startY);
        dispatchTouch("touchstart", [start], [start]);
        for (let step = 1; step <= 8; step++) {
          const touch = touchAt(startY + ((endY - startY) * step) / 8);
          dispatchTouch("touchmove", [touch], [touch]);
        }
        const end = touchAt(endY);
        dispatchTouch("touchend", [], [end]);
      },
      {
        x: bounds.x + 60,
        startY: bounds.y + 40,
        endY: bounds.y + 260,
      },
    );
    await expect(details).not.toBeVisible();
    await expect(rentRow).toBeVisible();

    await ctx.close();
  });
});
