import { expect, test } from "@playwright/test";
import { horizontalOverflow } from "./helpers/overflow";

// Auth screens must not scroll sideways at a phone viewport (pinch-to-fit guard).
for (const route of ["/auth/login", "/auth/signup"]) {
  test(`no horizontal overflow on ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible({ timeout: 15_000 });

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1); // sub-pixel slop
  });
}

// iOS zooms into inputs under 16px; controls must be >=16px on touch.
test("auth inputs render at >=16px to avoid iOS focus-zoom", async ({ page }) => {
  await page.goto("/auth/login");
  const field = page.getByLabel("Username");
  await expect(field).toBeVisible({ timeout: 15_000 });
  const fontPx = await field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(fontPx).toBeGreaterThanOrEqual(16);
});
