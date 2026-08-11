import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SwUpdateBanner } from "@/components/SwUpdateBanner";
import { AuthProvider } from "@/providers/auth-context";
import { QueryProvider } from "@/providers/query-client";
import { SyncProvider } from "@/providers/sync-context";
import { router } from "./router";
import "@fontsource-variable/schibsted-grotesk/index.css";
import "@fontsource-variable/spline-sans-mono/index.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./app/globals.css";

// index.html always renders <div id="root">, so the element is guaranteed.
// biome-ignore lint/style/noNonNullAssertion: Vite entry root is static.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <AuthProvider>
          <SyncProvider>
            <RouterProvider router={router} />
          </SyncProvider>
        </AuthProvider>
      </QueryProvider>
    </ErrorBoundary>
    {/* SW registration + update banner sit outside the ErrorBoundary on
        purpose: a crashed app must still register updates and surface them. */}
    <ServiceWorkerRegistration />
    <SwUpdateBanner />
  </StrictMode>,
);
