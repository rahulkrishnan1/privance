import { expect, test } from "@playwright/test";

// iOS zooms into inputs under 16px; controls must be >=16px on touch.
test("auth inputs render at >=16px to avoid iOS focus-zoom", async ({ page }) => {
  await page.goto("/auth/login/");
  const field = page.getByLabel("Username");
  await expect(field).toBeVisible({ timeout: 15_000 });
  const fontPx = await field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(fontPx).toBeGreaterThanOrEqual(16);
});
