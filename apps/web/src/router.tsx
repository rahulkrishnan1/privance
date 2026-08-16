import { createBrowserRouter } from "react-router";

// All pages are eager imports: auth-state transitions (login, unlock, logout)
// must not flash a blank Suspense fallback. Chart-heavy components are
// code-split inside each page (React.lazy), as they were pre-migration.

// Invest: layout route keeps hero + subnav mounted across tab switches.
import { InvestLayout } from "@/features/invest";
import { AccountsView } from "@/features/invest/components/accounts-view";
import { HoldingsView } from "@/features/invest/components/holdings-view";
import { OverviewView } from "@/features/invest/components/overview-view";
// Sibling app routes (plan, spend, settings) are flat — they don't share
// the invest layout.
import PlanPage from "./app/(app)/app/plan/page";
import SettingsPage from "./app/(app)/app/settings/page";
import SpendPage from "./app/(app)/app/spend/page";
import AppLayout from "./app/(app)/layout";
import LandingLayout from "./app/(landing)/layout";
import LandingPage from "./app/(landing)/page";
import AuthLayout from "./app/auth/layout";
import LoginPage from "./app/auth/login/page";
import RecoveryPage from "./app/auth/recovery/page";
import SignupPage from "./app/auth/signup/page";
// Layout shells
import RootShell from "./app/root-shell";
import UnlockPage from "./app/unlock/page";

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootShell />,
    children: [
      // Landing
      {
        element: <LandingLayout />,
        children: [{ index: true, element: <LandingPage /> }],
      },
      // Auth routes
      {
        path: "auth",
        element: <AuthLayout />,
        children: [
          { path: "login", element: <LoginPage /> },
          { path: "signup", element: <SignupPage /> },
          { path: "recovery", element: <RecoveryPage /> },
        ],
      },
      // Unlock
      { path: "unlock", element: <UnlockPage /> },
      // Auth-gated app routes
      {
        element: <AppLayout />,
        children: [
          {
            path: "app",
            element: <InvestLayout />,
            children: [
              { index: true, element: <OverviewView /> },
              { path: "holdings", element: <HoldingsView /> },
              { path: "accounts", element: <AccountsView /> },
            ],
          },
          { path: "app/plan", element: <PlanPage /> },
          { path: "app/spend", element: <SpendPage /> },
          { path: "app/settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
]);

export { router };
