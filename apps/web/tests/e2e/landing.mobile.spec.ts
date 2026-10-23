import { expect, test } from "@playwright/test";
import { horizontalOverflow } from "./helpers/overflow";

test("self-hosting guidance and signup fit a phone viewport", async ({ page }) => {
  await page.goto("/#deploy");
  await expect(page.getByRole("heading", { name: "Your money. Your server." })).toBeInViewport();
  const guide = page.getByRole("link", { name: "Self-host guide", exact: true }).last();
  await guide.scrollIntoViewIfNeeded();
  await expect(guide).toBeInViewport();
  await expect(guide).toHaveAttribute(
    "href",
    "https://github.com/rahulkrishnan1/privance/blob/main/infra/README.md",
  );
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/signup\/?$/);
  await expect(
    page.getByText("Only required if this instance uses invite-only signup."),
  ).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
});
