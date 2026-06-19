"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { InvestView } from "../invest-screen";

const NAV_ITEMS: Array<{ view: InvestView; label: string; href: string }> = [
  { view: "overview", label: "Overview", href: "/app" },
  { view: "holdings", label: "Holdings", href: "/app/holdings" },
  { view: "accounts", label: "Accounts", href: "/app/accounts" },
];

type InvestSubnavProps = {
  onAdd?: () => void;
  addLabel: string;
};

export function InvestSubnav({ onAdd, addLabel }: InvestSubnavProps) {
  const pathname = usePathname();

  const active: InvestView = pathname.startsWith("/app/holdings")
    ? "holdings"
    : pathname.startsWith("/app/accounts")
      ? "accounts"
      : "overview";

  return (
    <nav
      aria-label="Invest sub-navigation"
      className="flex gap-[30px] max-[760px]:gap-4 border-b border-line mt-2 sticky top-[62px] max-[760px]:top-14 bg-[color-mix(in_srgb,var(--color-vault)_92%,transparent)] backdrop-blur-[8px] z-[15]"
    >
      {NAV_ITEMS.map(({ view, label, href }) => {
        const isActive = active === view;
        return (
          <Link
            key={view}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={[
              "font-mono text-[11px] tracking-[.18em] uppercase py-4 px-0.5 border-b-2 -mb-px transition-colors whitespace-nowrap",
              isActive
                ? "text-cream border-accent"
                : "text-faint hover:text-cream-soft border-transparent",
            ].join(" ")}
          >
            {label}
          </Link>
        );
      })}
      <span className="flex-1" />
      {onAdd !== undefined && (
        <button
          type="button"
          onClick={onAdd}
          // Stable accessible name across viewports: the visible text collapses
          // to a bare "+" on mobile, but the label keeps the account/holding context.
          aria-label={`+ Add ${addLabel}`}
          className="font-mono text-[10.5px] tracking-[.12em] uppercase text-vault bg-accent rounded-md px-4 py-2 self-center cursor-pointer hover:bg-cream transition-colors"
        >
          <span className="max-[560px]:hidden">+ Add {addLabel}</span>
          <span className="hidden max-[560px]:inline" aria-hidden="true">
            +
          </span>
        </button>
      )}
    </nav>
  );
}
