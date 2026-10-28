import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import RootShell from "@/app/root-shell";

vi.mock("@/providers/auth-context", () => ({
  useAuth: () => ({ state: "unlocked", lock: vi.fn(), lockFailed: false }),
}));
vi.mock("@/components/SyncStatus", () => ({ SyncStatus: () => null }));
vi.mock("@/features/invest/components/refresh-prices-button", () => ({
  RefreshPricesButton: () => null,
}));

import AppLayout from "./layout";

afterEach(async () => {
  window.scrollTo({ top: 0, behavior: "instant" });
  await page.viewport(1280, 800);
});

test.for(["Spend", "Settings"])(
  "switches to %s without focus panning or animating the old scroll",
  async (destination) => {
    await page.viewport(390, 844);
    const router = createMemoryRouter(
      [
        {
          element: <RootShell />,
          children: [
            {
              path: "/app",
              element: <AppLayout />,
              children: [
                {
                  index: true,
                  element: (
                    <div style={{ height: 2400 }}>
                      <h1>Invest page</h1>
                    </div>
                  ),
                },
                {
                  path: "spend",
                  element: (
                    <div style={{ height: 1800 }}>
                      <h1>Spend page</h1>
                    </div>
                  ),
                },
                {
                  path: "settings",
                  element: (
                    <div style={{ height: 1800 }}>
                      <h1>Settings page</h1>
                    </div>
                  ),
                },
              ],
            },
          ],
        },
      ],
      { initialEntries: ["/app"] },
    );
    const screen = await render(<RouterProvider router={router} />);
    await expect.element(screen.getByRole("heading", { name: "Invest page" })).toBeVisible();
    window.scrollTo({ top: 1000, behavior: "instant" });
    const samples: number[] = [];
    let frame = 0;
    const sample = () => {
      if (
        router.state.location.pathname === `/app/${destination.toLowerCase()}` &&
        document.activeElement?.tagName === "MAIN"
      ) {
        samples.push(window.scrollY);
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    try {
      await screen
        .getByRole("navigation", { name: "Mobile navigation" })
        .getByRole("link", { name: destination, exact: true })
        .click();
      await expect.poll(() => samples.length).toBeGreaterThanOrEqual(5);
      expect(samples.every((y) => y === 0)).toBe(true);
      expect(document.activeElement).toBe(screen.getByRole("main").element());
      await router.navigate(-1);
      await expect.poll(() => window.scrollY).toBe(1000);
    } finally {
      cancelAnimationFrame(frame);
      router.dispose();
    }
  },
);
