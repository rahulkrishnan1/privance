import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

// A tall dialog must stay within the viewport and scroll its own body, rather
// than overflowing off-screen with no way to reach the bottom (the spend form
// shipped "stuck" because scroll lived on each call site, not the primitive).
test("DialogContent caps its height and scrolls when content overflows", async () => {
  await render(
    <Dialog open>
      <DialogContent aria-labelledby="t">
        <DialogTitle id="t">Tall</DialogTitle>
        <div style={{ height: "4000px" }}>filler</div>
      </DialogContent>
    </Dialog>,
  );

  const content = document.querySelector<HTMLElement>("[role=dialog]");
  if (!content) throw new Error("dialog content not found");

  // Capped below the 4000px content, so the body is actually scrollable.
  expect(content.clientHeight).toBeLessThan(content.scrollHeight);
  expect(content.clientHeight).toBeLessThanOrEqual(window.innerHeight);
});

// Radix Dialog moves focus into the dialog content on open. Guard against
// regressions where focus stays on the trigger or document body.
test("DialogContent receives focus when opened", async () => {
  await render(
    <Dialog open>
      <DialogContent aria-labelledby="focus-test-title">
        <DialogTitle id="focus-test-title">Focus test</DialogTitle>
        <button type="button">Inside</button>
      </DialogContent>
    </Dialog>,
  );

  const dialog = document.querySelector<HTMLElement>("[role=dialog]");
  if (!dialog) throw new Error("dialog not found");

  expect(dialog.contains(document.activeElement)).toBe(true);
});
