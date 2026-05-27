import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { loginAndCapture, restoreSession } from "./helpers/auth";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

test.describe("landing page", () => {
  test("renders for unauthenticated visitors", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");

    await expect(page.getByText("Track your wealth.").first()).toBeVisible();
    await expect(page.getByText(/AGPL-3\.0 licensed/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Request an invite/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  });

  test("Request an invite CTA navigates to /auth/signup", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: /Request an invite/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/auth\/signup/, { timeout: 10_000 });
  });

  test("Sign in link navigates to /auth/login", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Sign in" }).first().click();
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });
  });

  test("signed-in user visiting / is redirected to /app/", async ({ browser }) => {
    const { sharedUser } = loadFixtures();
    const session = await loginAndCapture(browser, {
      username: sharedUser.username,
      password: sharedUser.password,
    });

    const ctx = await browser.newContext({ baseURL: "http://localhost:8081" });
    const page = await ctx.newPage();
    await restoreSession(page, session);

    await page.goto("/");
    await expect(page).toHaveURL("/app/", { timeout: 15_000 });
    await ctx.close();
  });
});
