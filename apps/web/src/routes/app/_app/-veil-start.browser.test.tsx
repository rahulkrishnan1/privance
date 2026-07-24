/**
 * Browser tests for the figures-veil toggle in the app shell: the layout
 * restores the persisted toggle on mount and the `veil-on` container actually
 * obscures `vfig` figures. Start-veiled-at-auth is covered in
 * auth-context.veil.browser.test.tsx.
 */

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
// Import the real stylesheet so `.veil-on .vfig { filter: blur }` is in effect
// and getComputedStyle reports the actual obscuring, not just a class marker.
import "@/globals.css";

// The layout renders its page content through <Outlet>; the mock supplies a
// veiled figure there so the veil-on ancestor has something to obscure.
vi.mock("@tanstack/react-router", async () => {
  const { LinkStub, createFileRouteStub } = await import("@/__mocks__/router-stubs");
  return {
    createFileRoute: createFileRouteStub,
    Link: LinkStub,
    Outlet: () => (
      <span className="vfig" data-testid="figure">
        $1,234,567
      </span>
    ),
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/app" }),
  };
});

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({ state: "unlocked" as const, lock: vi.fn() }),
}));

// The TopBar children reach for query + sync providers we do not exercise here.
vi.mock("@/components/SyncStatus", () => ({ SyncStatus: () => null }));
vi.mock("@/features/invest/components/refresh-prices-button", () => ({
  RefreshPricesButton: () => null,
}));

import { Route as appRoute } from "../_app";

const AppLayout = appRoute.options.component as () => ReactNode;

const VEIL_KEY = "privance.veil.v1";

function filterOf(el: Element): string {
  return getComputedStyle(el).filter;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("app shell figures veil", () => {
  it("starts veiled and blurs figures when the persisted toggle is on", async () => {
    localStorage.setItem(VEIL_KEY, "1");

    const screen = await render(<AppLayout />);

    const toggle = screen.getByRole("button", { name: "Reveal figures" });
    await expect.element(toggle).toBeVisible();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");

    const fig = screen.container.querySelector("[data-testid='figure']");
    if (fig === null) throw new Error("figure not rendered");
    expect(filterOf(fig)).toContain("blur");
  });

  it("starts revealed and leaves figures sharp when the toggle is unset", async () => {
    const screen = await render(<AppLayout />);

    const toggle = screen.getByRole("button", { name: "Veil figures" });
    await expect.element(toggle).toBeVisible();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

    const fig = screen.container.querySelector("[data-testid='figure']");
    if (fig === null) throw new Error("figure not rendered");
    expect(filterOf(fig)).toBe("none");
  });

  it("blurs figures the moment the user veils and persists the choice", async () => {
    const screen = await render(<AppLayout />);

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
