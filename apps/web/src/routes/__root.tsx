import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SwUpdateBanner } from "@/components/SwUpdateBanner";

export const Route = createRootRoute({ component: RootComponent });

function RootComponent() {
  return (
    <>
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
      <ServiceWorkerRegistration />
      <SwUpdateBanner />
    </>
  );
}
