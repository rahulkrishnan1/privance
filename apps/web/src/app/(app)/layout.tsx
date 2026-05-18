"use client";

import { BarChart3, LogOut, Settings, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Logo } from "@/components/index";
import { logout as apiLogout } from "@/lib/api/auth";
import { useAuth } from "@/providers/auth-context";

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

type NavItem = {
  label: string;
  href: string;
  Icon: typeof BarChart3;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", Icon: BarChart3 },
  { label: "Accounts", href: "/accounts", Icon: Wallet },
  { label: "Holdings", href: "/holdings", Icon: TrendingUp },
  { label: "Settings", href: "/settings", Icon: Settings },
];

// ---------------------------------------------------------------------------
// Desktop sidebar
// ---------------------------------------------------------------------------

function Sidebar({ onLogout }: { onLogout: () => void | Promise<void> }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-44 md:flex-col md:fixed md:inset-y-0 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2.5">
        <Logo size={28} />
        <span className="text-lg font-bold text-neutral-900 dark:text-neutral-50 tracking-tight">
          Privance
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main navigation">
        {NAV_ITEMS.map(({ label, href, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={[
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none",
                active
                  ? "bg-gold-50 dark:bg-gold-950 text-gold-700 dark:text-gold-300"
                  : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-50",
              ].join(" ")}
            >
              <Icon
                size={18}
                className={active ? "text-gold-600 dark:text-gold-400" : ""}
                aria-hidden="true"
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-neutral-200 dark:border-neutral-800">
        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-50 transition-colors w-full focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none cursor-pointer"
        >
          <LogOut size={18} aria-hidden="true" />
          Log out
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mobile bottom tab bar
// ---------------------------------------------------------------------------

function BottomTabBar() {
  const pathname = usePathname();

  // Show only the main 4 nav items (no logout, accessible via settings)
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 flex [padding-bottom:env(safe-area-inset-bottom)]"
      aria-label="Main navigation"
    >
      {NAV_ITEMS.map(({ label, href, Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-400 focus-visible:outline-none min-h-14",
              active
                ? "text-gold-600 dark:text-gold-400"
                : "text-neutral-500 dark:text-neutral-500",
            ].join(" ")}
          >
            <Icon size={22} aria-hidden="true" />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export default function AppLayout({ children }: { children: ReactNode }) {
  const { state, logout } = useAuth();

  useEffect(() => {
    if (state === "unauthenticated") {
      window.location.replace("/auth/login/");
    } else if (state === "locked") {
      window.location.replace("/unlock/");
    }
  }, [state]);

  async function handleLogout() {
    await apiLogout().catch(() => undefined);
    logout();
    window.location.replace("/auth/login/");
  }

  return (
    <div className="min-h-svh bg-neutral-50 dark:bg-neutral-950">
      {/* Desktop sidebar */}
      <Sidebar onLogout={handleLogout} />

      {/* Main content, offset by sidebar width on desktop */}
      <div className="md:pl-44">
        {/* Content area; add bottom padding on mobile for the tab bar */}
        <div className="pb-16 md:pb-0">{children}</div>
      </div>

      {/* Mobile bottom tab bar */}
      <BottomTabBar />
    </div>
  );
}
