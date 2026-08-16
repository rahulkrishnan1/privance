import { Outlet, ScrollRestoration } from "react-router";

export default function RootShell() {
  return (
    <>
      {/* Canonical RR data-router scroll handling (back/forward restores,
          new navigations reset). Rendered at the root so every route —
          and any component mounted outside the router in tests — is safe. */}
      <ScrollRestoration />
      <Outlet />
    </>
  );
}
