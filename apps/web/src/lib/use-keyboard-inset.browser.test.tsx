import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useKeyboardInset } from "./use-keyboard-inset";

// A controllable stand-in for window.visualViewport so we can simulate the
// soft keyboard rising/falling, which a real headless browser never does.
class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

const realVV = Object.getOwnPropertyDescriptor(window, "visualViewport");
const realInner = Object.getOwnPropertyDescriptor(window, "innerHeight");

afterEach(() => {
  if (realVV) Object.defineProperty(window, "visualViewport", realVV);
  if (realInner) Object.defineProperty(window, "innerHeight", realInner);
});

function Probe() {
  const kb = useKeyboardInset();
  return (
    <output data-testid="kb">
      {kb.height}:{kb.available ?? "null"}
    </output>
  );
}

test("useKeyboardInset tracks the keyboard via visualViewport and cleans up", async () => {
  const vv = new FakeViewport();
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  const removeSpy = vi.spyOn(vv, "removeEventListener");

  const screen = await render(<Probe />);
  const cell = () => screen.getByTestId("kb").element().textContent;

  // No keyboard: viewport fills the window.
  await expect.poll(cell).toBe("0:null");

  // Keyboard rises: viewport shrinks by 300px.
  vv.height = 500;
  vv.dispatchEvent(new Event("resize"));
  await expect.poll(cell).toBe("300:500");

  // Keyboard dismisses: viewport returns to full height.
  vv.height = 800;
  vv.dispatchEvent(new Event("resize"));
  await expect.poll(cell).toBe("0:null");

  screen.unmount();
  expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
  expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
});

test("returns the inert default when visualViewport is unavailable", async () => {
  // OPFS-disabled / restricted WKWebView hosts can lack visualViewport; the hook
  // must fall back to the no-inset default instead of touching undefined.
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  const screen = await render(<Probe />);
  await expect.poll(() => screen.getByTestId("kb").element().textContent).toBe("0:null");
});
