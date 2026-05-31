"use client";

import { BarChart3, Settings, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Logo } from "@/components/index";
import { logout as apiLogout } from "@/lib/api/auth";
import { useAuth } from "@/providers/auth-context";

type NavItem = {
  label: string;
  href: string;
  Icon: typeof BarChart3;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/app", Icon: BarChart3 },
  { label: "Accounts", href: "/app/accounts", Icon: Wallet },
  { label: "Holdings", href: "/app/holdings", Icon: TrendingUp },
  { label: "Settings", href: "/app/settings", Icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" || pathname === "/app/" : pathname.startsWith(href);
}

function TopBar({
  onLock,
  onLogout,
}: {
  onLock: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const pathname = usePathname();

  return (
    <header className="hidden md:block sticky top-0 z-30 bg-app-panel-2/95 backdrop-blur border-b border-app-line">
      <div className="flex items-center gap-9 px-7 h-16">
        <Link href="/app" className="flex items-center gap-2.5 group">
          <Logo size={22} className="text-gold-accent" />
          <span
            className="font-serif text-[17px] text-app-text"
            style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
          >
            Privance
          </span>
        </Link>
        <span aria-hidden="true" className="h-5 w-px bg-app-line" />
        <nav className="flex-1 flex gap-1" aria-label="Main navigation">
          {NAV_ITEMS.map(({ label, href }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "relative px-3.5 py-2 rounded-lg text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit]",
                  active ? "text-gold-accent" : "text-app-muted hover:text-app-text",
                ].join(" ")}
              >
                {label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute left-3.5 right-3.5 -bottom-[23px] h-0.5 bg-gold-accent"
                  />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={onLock}
            aria-label="Lock"
            className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim hover:text-app-text transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] rounded-sm"
          >
            Lock
          </button>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold-accent hover:text-gold-accent-hover transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] rounded-sm"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function MobileHeader() {
  return (
    <header className="md:hidden sticky top-0 z-30 bg-app-panel-2/95 backdrop-blur border-b border-app-line [padding-top:env(safe-area-inset-top)]">
      <div className="flex items-center justify-center px-5 h-14">
        <Link href="/app" className="flex items-center gap-2">
          <Logo size={20} className="text-gold-accent" />
          <span
            className="font-serif text-[15px] text-app-text"
            style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
          >
            Privance
          </span>
        </Link>
      </div>
    </header>
  );
}

function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-app-panel-2 border-t border-app-line flex [padding-bottom:env(safe-area-inset-bottom)]"
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map(({ label, href, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-gold-accent min-h-14",
              active ? "text-gold-accent" : "text-app-dim",
            ].join(" ")}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { state, lock, logout } = useAuth();

  useEffect(() => {
    if (state === "unauthenticated") {
      window.location.replace("/auth/login/");
    } else if (state === "locked") {
      window.location.replace("/unlock/");
    }
  }, [state]);

  async function handleLogout() {
    await apiLogout().catch(() => undefined);
    // Await logout so the registered store.destroy() finishes before we unload.
    await logout();
    window.location.replace("/auth/login/");
  }

  return (
    <div className="dark min-h-svh bg-app-bg text-app-text">
      <TopBar onLock={lock} onLogout={handleLogout} />
      <MobileHeader />
      <main className="pb-16 md:pb-0">{children}</main>
      <BottomTabBar />
    </div>
  );
}
