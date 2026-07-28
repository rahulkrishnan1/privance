import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

// The Sheet shares the Dialog primitive but ships its own Popup positioning, so
// it gets its own dismissal + focus coverage. Escape must close it (the default
// modal dismissal that the detail sheets rely on alongside their Close button).
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
