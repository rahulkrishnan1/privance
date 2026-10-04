/**
 * Browser tests for the figures-veil toggle in the app shell: the layout
 * restores the persisted toggle on mount and obscures `vfig` figures, including
 * portaled sheets. Start-veiled-at-auth is covered in
 * auth-context.veil.browser.test.tsx.
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
// Import the real stylesheet so `.veil-on .vfig { filter: blur }` is in effect
// and getComputedStyle reports the actual obscuring, not just a class marker.
import "@/app/globals.css";

const mockReplace = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({ lockFailed: false }));
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => mockReplace,
    useLocation: () => ({ pathname: "/app", search: "", hash: "", state: null, key: "default" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({ state: "unlocked" as const, lock: vi.fn(), lockFailed: mockAuth.lockFailed }),
}));

// The TopBar children reach for query + sync providers we do not exercise here.
vi.mock("@/components/SyncStatus", () => ({ SyncStatus: () => null }));
vi.mock("@/features/invest/components/refresh-prices-button", () => ({
  RefreshPricesButton: () => null,
}));

import { MemoryRouter } from "react-router";
import AppLayout from "./layout";

const VEIL_KEY = "privance.veil.v1";

const figure = (
  <span className="vfig" data-testid="figure">
    $1,234,567
  </span>
);

function filterOf(el: Element): string {
  return getComputedStyle(el).filter;
}

function PortaledFigureSheet() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open test sheet
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle>Expense details</SheetTitle>
          <span className="vfig" data-testid="portal-figure">
            $20.00
          </span>
        </SheetContent>
      </Sheet>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  mockAuth.lockFailed = false;
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("app shell figures veil", () => {
  it("starts veiled and blurs figures when the persisted toggle is on", async () => {
    localStorage.setItem(VEIL_KEY, "1");

    const screen = await render(
      <MemoryRouter>
        <AppLayout>
          {figure}
          <PortaledFigureSheet />
        </AppLayout>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "Reveal figures" });
    await expect.element(toggle).toBeVisible();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");

    const fig = screen.container.querySelector("[data-testid='figure']");
    if (fig === null) throw new Error("figure not rendered");
    expect(filterOf(fig)).toContain("blur");

    await screen.getByRole("button", { name: "Open test sheet" }).click();
    const portalFigure = document.querySelector("[data-testid='portal-figure']");
    if (portalFigure === null) throw new Error("portaled figure not rendered");
    expect(filterOf(portalFigure)).toContain("blur");
  });

  it("starts revealed and leaves figures sharp when the toggle is unset", async () => {
    const screen = await render(
      <MemoryRouter>
        <AppLayout>{figure}</AppLayout>
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: "Veil figures" });
    await expect.element(toggle).toBeVisible();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

    const fig = screen.container.querySelector("[data-testid='figure']");
    if (fig === null) throw new Error("figure not rendered");
    expect(filterOf(fig)).toBe("none");
  });

  it("explains when browser storage prevents a secure lock", async () => {
    mockAuth.lockFailed = true;

    const screen = await render(
      <MemoryRouter>
        <AppLayout>{figure}</AppLayout>
      </MemoryRouter>,
    );

    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Couldn’t lock securely. Your session is still open.");
  });

  it("keeps the mobile navigation discoverable with one selected destination", async () => {
    const screen = await render(
      <MemoryRouter>
        <AppLayout>{figure}</AppLayout>
      </MemoryRouter>,
    );

    const nav = screen.container.querySelector('nav[aria-label="Mobile navigation"]');
    expect(nav).not.toBeNull();
    if (!nav) throw new Error("mobile navigation not rendered");
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[0]).toHaveTextContent("Invest");
  });

  it("blurs figures the moment the user veils and persists the choice", async () => {
    const screen = await render(
      <MemoryRouter>
        <AppLayout>{figure}</AppLayout>
      </MemoryRouter>,
    );

    const fig = screen.container.querySelector("[data-testid='figure']");
    if (fig === null) throw new Error("figure not rendered");
    expect(filterOf(fig)).toBe("none");

    await screen.getByRole("button", { name: "Veil figures" }).click();

    const toggle = screen.getByRole("button", { name: "Reveal figures" });
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    expect(filterOf(fig)).toContain("blur");
    expect(localStorage.getItem(VEIL_KEY)).toBe("1");
  });
});
