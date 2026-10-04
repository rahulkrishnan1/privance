import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
}

const realViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
const realInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");

afterEach(async () => {
  if (realViewport) Object.defineProperty(window, "visualViewport", realViewport);
  if (realInnerHeight) Object.defineProperty(window, "innerHeight", realInnerHeight);
  await page.viewport(1280, 800);
});

// The responsive Sheet uses Base UI's Drawer primitive. Escape dismissal and
// focus containment are contracts that every account/holding detail relies on.
test("Sheet closes on Escape", async () => {
  const onOpenChange = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <Sheet
        open={open}
        onOpenChange={(o, details) => {
          onOpenChange(o, details);
          setOpen(o);
        }}
      >
        <SheetContent aria-labelledby="sheet-esc">
          <SheetTitle id="sheet-esc">Escape test</SheetTitle>
          <button type="button">Inside</button>
        </SheetContent>
      </Sheet>
    );
  }
  await render(<Harness />);
  const sheet = document.querySelector<HTMLElement>("[role=dialog]");
  if (!sheet) throw new Error("sheet not found");
  // Focus lands inside the sheet on open (Base UI moves it asynchronously).
  await expect.poll(() => sheet.contains(document.activeElement)).toBe(true);

  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

  await expect.poll(() => document.querySelector("[role=dialog]")).toBeNull();
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
});

test("Sheet stays above the software keyboard while editing", async () => {
  await page.viewport(390, 800);
  const viewport = new FakeViewport();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  function Harness() {
    return (
      <Sheet open>
        <SheetContent aria-labelledby="sheet-keyboard">
          <SheetTitle id="sheet-keyboard">Keyboard test</SheetTitle>
          <input aria-label="Amount" />
        </SheetContent>
      </Sheet>
    );
  }

  await render(<Harness />);
  const popup = document.querySelector<HTMLElement>("[role=dialog]");
  if (!popup) throw new Error("sheet not found");
  await page.getByRole("textbox", { name: "Amount" }).click();
  viewport.height = 500;
  viewport.dispatchEvent(new Event("resize"));
  await expect.poll(() => popup.getBoundingClientRect().bottom).toBeCloseTo(500, 0);
});
