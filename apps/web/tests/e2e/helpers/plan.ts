import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Opens the assumptions editor. Desktop expands inline; mobile opens a
 * full-screen sheet via Adjust. Safe to call when it is already open (desktop
 * first-time setup renders the form inline straight away).
 */
export async function ensureAssumptionsExpanded(page: Page): Promise<void> {
  const ageField = page.getByLabel("Current age");
  const adjust = page.getByRole("button", { name: "Adjust plan" });
  // Wait until the editor is either already open or can be opened.
  await expect(ageField.or(adjust)).toBeVisible({ timeout: 15_000 });
  if (await ageField.isVisible().catch(() => false)) return;
  await adjust.click();
  await expect(ageField).toBeVisible({ timeout: 10_000 });
}
