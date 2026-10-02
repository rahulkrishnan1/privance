import type { ComponentType } from "react";
import { createBrowserRouter } from "react-router";
import RootShell from "./app/root-shell";
import { RouteLoading } from "./components/RouteLoading";

function lazyDefault(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default });
}

// Keep only the route map and root shell on the startup path. React Router
// resolves every matched lazy route in parallel, so direct links still render
// in one pass while unrelated auth, planning, settings, and investing code stay
// out of the initial bundle.
const router = createBrowserRouter([
  {
    path: "/",
    Component: RootShell,
    HydrateFallback: RouteLoading,
    children: [
      {
        lazy: lazyDefault(() => import("./app/(landing)/layout")),
        children: [
          {
            index: true,
            lazy: lazyDefault(() => import("./app/(landing)/page")),
          },
        ],
      },
      {
        path: "auth",
        lazy: lazyDefault(() => import("./app/auth/layout")),
        children: [
          {
            path: "login",
            lazy: lazyDefault(() => import("./app/auth/login/page")),
          },
          {
            path: "signup",
            lazy: lazyDefault(() => import("./app/auth/signup/page")),
          },
          {
            path: "recovery",
            lazy: lazyDefault(() => import("./app/auth/recovery/page")),
          },
        ],
      },
      {
        path: "unlock",
        lazy: lazyDefault(() => import("./app/unlock/page")),
      },
      {
        lazy: lazyDefault(() => import("./app/(app)/layout")),
        children: [
          {
            path: "app",
            lazy: async () => ({
              Component: (await import("./features/invest/invest-layout")).InvestLayout,
            }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import("./features/invest/components/overview-view"))
                    .OverviewView,
                }),
              },
              {
                path: "holdings",
                lazy: async () => ({
                  Component: (await import("./features/invest/components/holdings-view"))
                    .HoldingsView,
                }),
              },
              {
                path: "accounts",
                lazy: async () => ({
                  Component: (await import("./features/invest/components/accounts-view"))
                    .AccountsView,
                }),
              },
            ],
          },
          {
            path: "app/plan",
            lazy: lazyDefault(() => import("./app/(app)/app/plan/page")),
          },
          {
            path: "app/spend",
            lazy: lazyDefault(() => import("./app/(app)/app/spend/page")),
          },
          {
            path: "app/settings",
            lazy: lazyDefault(() => import("./app/(app)/app/settings/page")),
          },
        ],
      },
    ],
  },
]);

export { router };
