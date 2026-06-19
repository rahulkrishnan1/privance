"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode, SVGProps } from "react";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/index";
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

// Invest groups the Overview / Holdings / Accounts sub-views, so its tab stays
// active across all three routes.
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

function TopBar({
  veiled,
  onToggleVeil,
  onLock,
}: {
  veiled: boolean;
  onToggleVeil: () => void;
  onLock: () => void;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-line-soft bg-[color-mix(in_srgb,var(--color-vault)_88%,transparent)] backdrop-blur-[12px] [padding-top:env(safe-area-inset-top)]">
      <div className="mx-auto flex h-[62px] max-w-[1120px] items-center justify-between px-7 max-[760px]:h-14">
        <Link href="/app" className="flex items-center gap-[9px] text-cream">
          <Logo size={23} className="text-cream" />
          <span className="font-serif text-[21px]">Privance</span>
        </Link>

        <nav
          className="flex gap-1 rounded-full border border-line bg-panel p-1 max-[760px]:hidden"
          aria-label="Primary navigation"
        >
          {NAV_ITEMS.map(({ label, href, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "rounded-full px-[18px] py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  active ? "bg-cream text-vault" : "text-dim hover:text-cream",
                ].join(" ")}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex gap-2.5 items-center">
          <RefreshPricesButton />
          <button
            type="button"
            onClick={onToggleVeil}
            aria-pressed={veiled}
            aria-label={veiled ? "Reveal figures" : "Veil figures"}
            title={veiled ? "Reveal figures" : "Veil figures"}
            className={[
              "flex h-[38px] w-[38px] items-center justify-center rounded-full border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              veiled
                ? "border-accent-dim text-accent"
                : "border-line text-dim hover:border-accent-dim hover:text-accent",
            ].join(" ")}
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
          </button>
          <button
            type="button"
            onClick={onLock}
            aria-label="Lock"
            title="Lock"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-line text-dim transition-colors cursor-pointer hover:border-accent-dim hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
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
          </button>
        </div>
      </div>
    </header>
  );
}

function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 hidden border-t border-line bg-[color-mix(in_srgb,var(--color-vault)_90%,transparent)] px-2.5 pt-2 backdrop-blur-[14px] max-[760px]:flex [padding-bottom:calc(0.5rem+env(safe-area-inset-bottom))]"
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS.map(({ label, href, Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex flex-1 flex-col items-center gap-1 py-1.5 font-mono text-[8.5px] uppercase tracking-[0.18em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
              active ? "text-accent" : "text-faint",
            ].join(" ")}
          >
            <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { state, lock } = useAuth();
  const router = useRouter();
  const hydrated = useHydrated();
  const [veiled, setVeiled] = useState(false);

  // Restore the figures toggle; the auth context resets it on sign-in / unlock.
  useEffect(() => {
    setVeiled(readVeil());
  }, []);

  const toggleVeil = useCallback(() => {
    setVeiled((v) => {
      const next = !v;
      writeVeil(next);
      return next;
    });
  }, []);

  useEffect(() => {
    // Soft nav: no DEK exists in memory on a cold boot into locked/unauthenticated,
    // so router.replace is safe here. The lock/logout actions do their own hard
    // reload in auth-context for DEK scrub; this path is boot-only.
    if (state === "unauthenticated") {
      router.replace("/auth/login/");
    } else if (state === "locked") {
      router.replace("/unlock/");
    }
  }, [state, router]);

  // Hold a blank splash until hydrated and unlocked: gating on state alone
  // would diverge from the prerendered HTML (hydration mismatch), and painting
  // the shell before auth resolves flashes the dashboard on a cold launch.
  if (!hydrated || state !== "unlocked") {
    return <div className="dark min-h-svh bg-vault" />;
  }

  return (
    <div className={`dark min-h-svh bg-vault text-cream${veiled ? " veil-on" : ""}`}>
      <TopBar veiled={veiled} onToggleVeil={toggleVeil} onLock={lock} />
      <SyncStatus />
      {/* Clear the fixed bottom nav plus the iOS home-indicator safe area, so the
          last content is never hidden behind the nav. */}
      <main className="[padding-bottom:calc(4.5rem+env(safe-area-inset-bottom))] min-[760px]:pb-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
