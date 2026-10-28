import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

const realViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");

afterEach(async () => {
  if (realViewport) Object.defineProperty(window, "visualViewport", realViewport);
  await page.viewport(1280, 800);
});

test.for([60, 300])(
  "mobile Dialog leaves top clearance when the keyboard pans the viewport (offset %i)",
  async (offsetTop) => {
    await page.viewport(390, 800);
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    await render(
      <Dialog open>
        <DialogContent aria-labelledby="mobile-title">
          <DialogTitle id="mobile-title">Edit details</DialogTitle>
          <input aria-label="Name" />
          <div style={{ height: 1200 }}>Long form</div>
        </DialogContent>
      </Dialog>,
    );
    const popup = document.querySelector<HTMLElement>("[role=dialog]");
    if (!popup) throw new Error("dialog not found");
    viewport.height = 420;
    viewport.offsetTop = offsetTop;
    viewport.dispatchEvent(new Event("resize"));
    await expect.poll(() => popup.getBoundingClientRect().bottom).toBeCloseTo(420 + offsetTop, 0);
    expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(offsetTop + 12);
    expect(popup.clientHeight).toBeLessThan(popup.scrollHeight);
  },
);

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

// The modal dialog moves focus into its content on open. Guard against
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

  // Base UI moves focus into the popup asynchronously (after mount), so poll
  // rather than asserting synchronously.
  await expect.poll(() => dialog.contains(document.activeElement)).toBe(true);
});

// Escape must close the dialog (the default modal dismissal). Call sites that
// need to block it opt out via onOpenChange (see change-password-dialog).
test("Dialog closes on Escape", async () => {
  const onOpenChange = vi.fn();
  // biome-ignore lint/correctness/noComponentHookFactories: test-local harness; identity is stable within one render
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <Dialog
        open={open}
        onOpenChange={(o, details) => {
          onOpenChange(o, details);
          setOpen(o);
        }}
      >
        <DialogContent aria-labelledby="esc-title">
          <DialogTitle id="esc-title">Escape test</DialogTitle>
          <button type="button">Inside</button>
        </DialogContent>
      </Dialog>
    );
  }
  await render(<Harness />);
  expect(document.querySelector("[role=dialog]")).not.toBeNull();

  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

  await expect.poll(() => document.querySelector("[role=dialog]")).toBeNull();
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
});
