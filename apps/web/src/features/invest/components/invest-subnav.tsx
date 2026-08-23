import { useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { useSegmentPosition } from "@/components/ui/radio-group";
import { useInvestDashboard } from "../invest-context";

type InvestView = "overview" | "holdings" | "accounts";

const NAV_ITEMS: Array<{ view: InvestView; label: string; href: string }> = [
  { view: "overview", label: "Overview", href: "/app" },
  { view: "holdings", label: "Holdings", href: "/app/holdings" },
  { view: "accounts", label: "Accounts", href: "/app/accounts" },
];

export function InvestSubnav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { bumpAddHolding, openAddAccount } = useInvestDashboard();

  const active: InvestView = location.pathname.startsWith("/app/holdings")
    ? "holdings"
    : location.pathname.startsWith("/app/accounts")
      ? "accounts"
      : "overview";

  // Accounts open their form in the persistent layout; Holdings uses a
  // one-shot signal; Overview navigates to Holdings with modal state.
  const onAdd =
    active === "accounts"
      ? openAddAccount
      : active === "holdings"
        ? bumpAddHolding
        : () => {
            // This action opens a modal on the destination route. Keep the
            // route change synchronous so the modal's own sheet animation is
            // not composited into the page view transition.
            navigate("/app/holdings", {
              viewTransition: false,
              preventScrollReset: true,
              state: { openAddHolding: true },
            });
          };

  const addLabel = active === "accounts" ? "account" : "holding";

  const navRef = useRef<HTMLElement | null>(null);
  const activePos = useSegmentPosition(navRef, '[aria-current="page"]');

  return (
    <nav
      ref={navRef}
      aria-label="Invest sub-navigation"
      className="relative flex gap-[30px] max-[760px]:gap-4 border-b border-line mt-2 sticky top-[62px] max-[760px]:top-14 bg-[color-mix(in_srgb,var(--color-vault)_92%,transparent)] backdrop-blur-[8px] z-[15]"
    >
      {NAV_ITEMS.map(({ view, label, href }) => {
        const isActive = active === view;
        return (
          <Link
            key={view}
            to={href}
            viewTransition
            preventScrollReset
            aria-current={isActive ? "page" : undefined}
            className={[
              "font-mono text-xs tracking-button uppercase py-4 px-0.5 transition ease-out duration-150 whitespace-nowrap active:scale-[0.97] motion-reduce:active:scale-100",
              isActive ? "text-cream" : "text-faint hover:text-cream-soft",
            ].join(" ")}
          >
            {label}
          </Link>
        );
      })}
      <span className="flex-1" />
      {/* Underline glides between tabs, replacing the old border-b-2 accent on the
          active Link. Measurement reuses useSegmentPosition from radio-group.tsx
          (option b — shared hook) so geometry logic is not duplicated. */}
      {activePos && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-[2px] bg-accent pointer-events-none transition-transform duration-200 ease-[var(--ease-in-out)] will-change-transform motion-reduce:transition-none"
          style={{
            width: activePos.width,
            transform: `translateX(${activePos.left}px)`,
          }}
        />
      )}
      <button
        type="button"
        onClick={onAdd}
        aria-label={`+ Add ${addLabel}`}
        className="font-mono text-xs tracking-button uppercase text-vault bg-accent rounded-md px-4 py-2 self-center cursor-pointer hover:bg-cream transition ease-out duration-150 active:scale-[0.97] motion-reduce:active:scale-100"
      >
        <span className="max-[560px]:hidden">+ Add {addLabel}</span>
        <span className="hidden max-[560px]:inline" aria-hidden="true">
          +
        </span>
      </button>
    </nav>
  );
}
