import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";
import { loginAndCapture, restoreSession } from "./helpers/auth";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

test.describe("landing page", () => {
  test("renders for unauthenticated visitors", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");

    await expect(page.getByRole("heading", { name: /Personal finance/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Have an invite/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  });

  test("signed-in user visiting / is redirected to /app/", async ({ browser }) => {
    const { sharedUser } = loadFixtures();
    const session = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });

    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    await restoreSession(page, session);

    await page.goto("/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    await ctx.close();
  });
});
