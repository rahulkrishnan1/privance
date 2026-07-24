import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "@/globals.css";
import { AccountForm } from "./account-form";

async function openForm() {
  const screen = await render(
    <AccountForm open defaultKind="investment" onClose={() => {}} onSubmit={vi.fn()} />,
  );
  // Wait for the sheet's open animation to settle before reading geometry.
  await expect.element(screen.getByRole("dialog")).toBeVisible();
  return screen;
}

function kindRowTops(screen: Awaited<ReturnType<typeof openForm>>) {
  return ["Investment", "Cash", "Asset", "Liability"].map((name) =>
    Math.round(screen.getByRole("radio", { name }).element().getBoundingClientRect().top),
  );
}

// Regression: on a narrow (mobile bottom-sheet) viewport the four KIND options
// rendered as one flex row whose uppercase mono labels (INVESTMENT, LIABILITY)
// overflowed the sheet, forcing the whole page to scroll horizontally. They wrap
// to a 2x2 grid below the 560px sheet breakpoint and stay 4-up above it.
test("KIND options wrap to two rows on a mobile-width sheet without horizontal overflow", async () => {
  await page.viewport(360, 780);
  try {
    const screen = await openForm();
    expect(new Set(kindRowTops(screen)).size).toBe(2);

    // The reported symptom: nothing forces the page wider than the viewport.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  } finally {
    await page.viewport(1280, 800);
  }
});

test("KIND options stay on one row above the 560px sheet breakpoint", async () => {
  await page.viewport(800, 900);
  try {
    const screen = await openForm();
    expect(new Set(kindRowTops(screen)).size).toBe(1);
  } finally {
    await page.viewport(1280, 800);
  }
});
