import type { Page } from "@playwright/test";

/**
 * Widest non-decorative element's overflow past the viewport, in px.
 *
 * Not scrollWidth: the root sets `overflow-x: clip`, which clamps scrollWidth to
 * the viewport and would hide real overflow. `aria-hidden` layers are decorative
 * and may exceed the viewport by design, so they are skipped.
 */
export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    let max = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > max) max = r.right;
    }
    return max - vw;
  });
}
