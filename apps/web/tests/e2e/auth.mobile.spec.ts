import { expect, test } from "@playwright/test";

// iOS zooms into inputs under 16px; controls must be >=16px on touch.
test("auth inputs render at >=16px to avoid iOS focus-zoom", async ({ page }) => {
  await page.goto("/auth/login/");
  const field = page.getByLabel("Username");
  await expect(field).toBeVisible({ timeout: 15_000 });
  const fontPx = await field.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(fontPx).toBeGreaterThanOrEqual(16);
});

test("login stays scrollable above the software keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/auth/login/");
  await expect(page.getByLabel("Username")).toBeVisible({ timeout: 15_000 });

  const main = page.getByRole("main");
  await expect
    .poll(() => main.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  const signIn = page.getByRole("button", { name: "Sign in" });
  await signIn.scrollIntoViewIfNeeded();
  await expect(signIn).toBeInViewport();

  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visual viewport is unavailable");
    Object.defineProperty(viewport, "height", {
      configurable: true,
      value: window.innerHeight - 300,
    });
    viewport.dispatchEvent(new Event("resize"));
  });

  await expect
    .poll(() =>
      main.evaluate((element) => element.parentElement?.style.getPropertyValue("--kb-bottom")),
    )
    .toBe("300px");
  await expect
    .poll(() => main.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);

  await signIn.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      signIn.evaluate((element) => {
        const viewport = window.visualViewport;
        if (!viewport) return false;
        const bounds = element.getBoundingClientRect();
        return (
          bounds.top >= viewport.offsetTop && bounds.bottom <= viewport.offsetTop + viewport.height
        );
      }),
    )
    .toBe(true);

  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visual viewport is unavailable");
    Object.defineProperty(viewport, "height", {
      configurable: true,
      value: window.innerHeight,
    });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(() =>
      main.evaluate((element) => element.parentElement?.style.getPropertyValue("--kb-bottom")),
    )
    .toBe("0px");
  await expect
    .poll(() => main.evaluate((element) => getComputedStyle(element).alignItems))
    .toBe("center");
});
