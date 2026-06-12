import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { InfoTip } from "./info-tip";

// The tooltip is portalled to <body>, so assert against the whole page, not the
// render container. These cover the two reported touch bugs: tapping a second
// icon left the first open (no single-open), and tapping elsewhere never closed
// an open tooltip.

function tap(el: Element) {
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
}

function tooltipTexts(): string[] {
  return Array.from(document.querySelectorAll('[role="tooltip"]')).map((n) => n.textContent ?? "");
}

test("only one tooltip is open at a time, and tapping outside dismisses it", async () => {
  const screen = await render(
    <div>
      <InfoTip label="About A" text="Explanation A" />
      <InfoTip label="About B" text="Explanation B" />
      <button type="button">Elsewhere</button>
    </div>,
  );

  tap(screen.getByRole("button", { name: "About A" }).element());
  await expect.poll(tooltipTexts).toEqual(["Explanation A"]);

  // Opening B closes A: exactly one tooltip, showing B.
  tap(screen.getByRole("button", { name: "About B" }).element());
  await expect.poll(tooltipTexts).toEqual(["Explanation B"]);

  // Tapping a real element elsewhere on the page (not the icon) dismisses it.
  screen
    .getByRole("button", { name: "Elsewhere" })
    .element()
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await expect.poll(tooltipTexts).toEqual([]);
});

test("scrolling dismisses an open tooltip", async () => {
  const screen = await render(<InfoTip label="About A" text="Explanation A" />);

  tap(screen.getByRole("button", { name: "About A" }).element());
  await expect.poll(tooltipTexts).toEqual(["Explanation A"]);

  // A fixed-position tooltip would detach from its icon on scroll, so it closes.
  window.dispatchEvent(new Event("scroll"));
  await expect.poll(tooltipTexts).toEqual([]);
});

test("Escape dismisses an open tooltip", async () => {
  const screen = await render(<InfoTip label="About A" text="Explanation A" />);

  tap(screen.getByRole("button", { name: "About A" }).element());
  await expect.poll(tooltipTexts).toEqual(["Explanation A"]);

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await expect.poll(tooltipTexts).toEqual([]);
});
