import type { Locator } from "@playwright/test";

/**
 * Sets a React-controlled <input type="range"> to an exact value. Playwright's
 * fill() is unreliable on range sliders (it intermittently lands on the min
 * under load), so drive the native value setter React tracks and dispatch the
 * input + change events so the controlling onChange fires deterministically.
 */
export async function setSlider(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
