import { createFileRoute, Outlet } from "@tanstack/react-router";

const GRAIN_SVG =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const Route = createFileRoute("/_landing")({
  component: LandingLayout,
});

function LandingLayout() {
  return (
    <div className="relative min-h-svh bg-vault text-cream antialiased selection:bg-accent-dim/30 selection:text-cream">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.04] mix-blend-overlay"
        style={{ backgroundImage: GRAIN_SVG }}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[60vh] bg-[radial-gradient(ellipse_at_top,_rgba(94,234,212,0.10),_transparent_60%)]"
      />

      <div className="relative z-10">
        <Outlet />
      </div>
    </div>
  );
}
