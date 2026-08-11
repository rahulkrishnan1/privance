import { createBrowserRouter } from "react-router";

// All pages are eager imports: auth-state transitions (login, unlock, logout)
// must not flash a blank Suspense fallback. Chart-heavy components are
// code-split inside each page (React.lazy), as they were pre-migration.

import AccountsPage from "./app/(app)/app/accounts/page";
import HoldingsPage from "./app/(app)/app/holdings/page";
import AppPage from "./app/(app)/app/page";
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
          { path: "app", element: <AppPage /> },
          { path: "app/accounts", element: <AccountsPage /> },
          { path: "app/holdings", element: <HoldingsPage /> },
          { path: "app/plan", element: <PlanPage /> },
          { path: "app/spend", element: <SpendPage /> },
          { path: "app/settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
]);

export { router };
