import type { ReactNode, SVGProps } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from "react-router";
import { AuthErrorBar } from "@/components/auth/AuthErrorBar";
import { Logo, RoundIconButton } from "@/components/index";
import { SyncStatus } from "@/components/SyncStatus";
import { RefreshPricesButton } from "@/features/invest/components/refresh-prices-button";
import { useHydrated } from "@/lib/use-hydrated";
import { readVeil, writeVeil } from "@/lib/veil";
import { useAuth } from "@/providers/auth-context";

type IconProps = SVGProps<SVGSVGElement>;

function InvestIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      {...props}
    >
      <path d="M3 17l5-6 4 3 6-8 3 4" />
    </svg>
  );
}
function SpendIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}
function PlanIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      {...props}
    >
      <path d="M4 19c4-1 7-4 8-8m4-4c-1 2-2 4-4 4" />
      <circle cx="18" cy="5" r="2.4" />
    </svg>
  );
}
function SettingsIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
      {...props}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" />
    </svg>
  );
}

type NavItem = {
  label: string;
  href: string;
  Icon: (props: IconProps) => ReactNode;
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    label: "Invest",
    href: "/app",
    Icon: InvestIcon,
    match: (p) =>
      p === "/app" ||
      p === "/app/" ||
      p.startsWith("/app/holdings") ||
      p.startsWith("/app/accounts"),
  },
  { label: "Spend", href: "/app/spend", Icon: SpendIcon, match: (p) => p.startsWith("/app/spend") },
  { label: "Plan", href: "/app/plan", Icon: PlanIcon, match: (p) => p.startsWith("/app/plan") },
  {
    label: "Settings",
    href: "/app/settings",
    Icon: SettingsIcon,
    match: (p) => p.startsWith("/app/settings"),
  },
];
const TOP_LEVEL_APP_PATHS = ["/app/plan", "/app/spend", "/app/settings"];

function isInvestPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return (
    normalized === "/app" ||
    (normalized.startsWith("/app/") &&
      !TOP_LEVEL_APP_PATHS.some((path) => normalized === path || normalized.startsWith(`${path}/`)))
  );
}

function TopBar({
  veiled,
  onToggleVeil,
  onLock,
}: {
  veiled: boolean;
  onToggleVeil: () => void;
  onLock: () => void;
}) {
  const location = useLocation();

  return (
    <header className="sticky top-0 z-20 border-b border-line-soft bg-[color-mix(in_srgb,var(--color-vault)_88%,transparent)] backdrop-blur-[12px] [padding-top:env(safe-area-inset-top)]">
      <div
        style={{ viewTransitionName: "top-bar" }}
        className="mx-auto flex h-[62px] max-w-[1120px] items-center justify-between px-7 max-md:h-14"
      >
        <Link
          to="/app"
          preventScrollReset={isInvestPath(location.pathname)}
          className="flex items-center gap-[9px] text-cream"
        >
          <Logo size={23} className="text-cream" />
          <span className="font-serif text-2xl">Privance</span>
        </Link>

        <nav
          className="flex gap-1 rounded-full border border-line bg-panel p-1 max-md:hidden"
          aria-label="Primary navigation"
        >
          {NAV_ITEMS.map(({ label, href, match }) => {
            const active = match(location.pathname);
            return (
              <Link
                key={href}
                to={href}
                viewTransition
                preventScrollReset={isInvestPath(location.pathname) && isInvestPath(href)}
                aria-current={active ? "page" : undefined}
                className={[
                  "rounded-full px-[18px] py-2 font-mono text-xs uppercase tracking-button transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  active ? "bg-control-primary text-vault" : "text-dim hover:text-cream",
                ].join(" ")}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex gap-2.5 items-center">
          <RefreshPricesButton />
          <RoundIconButton
            onClick={onToggleVeil}
            label={veiled ? "Reveal figures" : "Veil figures"}
            title={veiled ? "Reveal figures" : "Veil figures"}
            pressed={veiled}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
          </RoundIconButton>
          <RoundIconButton onClick={onLock} label="Lock" title="Lock">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              className="h-4 w-4"
              aria-hidden="true"
            >
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </RoundIconButton>
        </div>
      </div>
    </header>
  );
}

function BottomNav() {
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const root = document.documentElement;
    const updateClearance = () => {
      if (window.matchMedia("(min-width: 768px)").matches) {
        root.style.removeProperty("--mobile-nav-clearance");
        return;
      }
      const { top } = nav.getBoundingClientRect();
      const clearance = `${Math.ceil(window.innerHeight - top + 12)}px`;
      if (root.style.getPropertyValue("--mobile-nav-clearance") !== clearance) {
        root.style.setProperty("--mobile-nav-clearance", clearance);
      }
    };

    updateClearance();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateClearance);
    observer?.observe(nav);
    window.addEventListener("resize", updateClearance);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateClearance);
      root.style.removeProperty("--mobile-nav-clearance");
    };
  }, []);

  return (
    <nav
      ref={navRef}
      className="floating-material fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-[45] hidden rounded-[22px] p-1.5 max-md:flex"
      aria-label="Mobile navigation"
    >
      <div className="flex w-full items-stretch" style={{ viewTransitionName: "bottom-nav" }}>
        {NAV_ITEMS.map(({ label, href, Icon, match }) => {
          const active = match(location.pathname);
          return (
            <Link
              key={href}
              to={href}
              viewTransition
              preventScrollReset={isInvestPath(location.pathname) && isInvestPath(href)}
              aria-current={active ? "page" : undefined}
              className={[
                "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-[17px] font-sans text-xs font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
                active ? "text-cream" : "text-dim",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-8 w-12 items-center justify-center rounded-[14px] transition-colors motion-reduce:transition-none",
                  active ? "bg-control-primary text-vault" : "",
                ].join(" ")}
              >
                <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// children is a test-only escape hatch: the router renders routes via
// <Outlet />, but browser tests mount AppLayout directly with children.
export default function AppLayout({ children }: { children?: ReactNode }) {
  const { state, lock, lockFailed } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const hydrated = useHydrated();
  const [veiled, setVeiled] = useState(readVeil);
  const mainRef = useRef<HTMLElement>(null);
  const previousPathnameRef = useRef(pathname);

  useLayoutEffect(() => {
    document.body.classList.toggle("veil-on", veiled);
    return () => document.body.classList.remove("veil-on");
  }, [veiled]);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    const pathnameChanged = previousPathname !== pathname;
    previousPathnameRef.current = pathname;
    if (!pathnameChanged || navigationType === "POP") return;

    const { activeElement } = document;
    const skipFocus =
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      activeElement instanceof HTMLSelectElement ||
      (activeElement instanceof HTMLElement && activeElement.isContentEditable);
    if (!skipFocus) {
      mainRef.current?.focus({
        preventScroll: isInvestPath(previousPathname) && isInvestPath(pathname),
      });
    }
  }, [pathname, navigationType]);

  const toggleVeil = useCallback(() => {
    setVeiled((v) => {
      const next = !v;
      writeVeil(next);
      return next;
    });
  }, []);

  useEffect(() => {
    // Soft nav: no DEK exists in memory on a cold boot into locked/unauthenticated,
    // so navigate is safe here. The lock/logout actions do their own hard
    // reload in auth-context for DEK scrub; this path is boot-only.
    if (state === "unauthenticated") navigate("/auth/login", { replace: true });
    else if (state === "locked") navigate("/unlock", { replace: true });
  }, [state, navigate]);

  if (!hydrated || state !== "unlocked") {
    return <div className="min-h-svh bg-vault" />;
  }

  return (
    <div className="min-h-svh bg-vault text-cream">
      <TopBar veiled={veiled} onToggleVeil={toggleVeil} onLock={lock} />
      {lockFailed && (
        <div className="mx-4 md:mx-8">
          <AuthErrorBar lead="Couldn’t lock securely.">
            Your session is still open. Check browser storage, then try again.
          </AuthErrorBar>
        </div>
      )}
      <SyncStatus />
      <main
        ref={mainRef}
        tabIndex={-1}
        className="outline-none pb-[var(--mobile-nav-clearance)] md:pb-4"
      >
        {children ?? <Outlet />}
      </main>
      <BottomNav />
    </div>
  );
}
