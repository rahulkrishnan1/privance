"use client";

import type { InvestmentAccount } from "@privance/core";
import { ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useMediaQuery } from "@/lib/use-media-query";
import type { FilterState, LocalGroup } from "../types";

type ScopeMenuProps = {
  filter: FilterState;
  label: string;
  count: number;
  accounts: InvestmentAccount[];
  groups: LocalGroup[];
  accountCounts: Map<string, number>;
  groupCounts: Map<string, number>;
  totalCount: number;
  onSelect: (next: FilterState) => void;
  onEditGroups: () => void;
};

function isActive(filter: FilterState, target: FilterState): boolean {
  if (filter.kind === "all" && target.kind === "all") return true;
  if (filter.kind === "account" && target.kind === "account")
    return filter.accountId === target.accountId;
  if (filter.kind === "group" && target.kind === "group") return filter.groupId === target.groupId;
  return false;
}

export function ScopeMenu({
  filter,
  label,
  count,
  accounts,
  groups,
  accountCounts,
  groupCounts,
  totalCount,
  onSelect,
  onEditGroups,
}: ScopeMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const isMobile = useMediaQuery("(max-width: 560px)");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingId = useId();

  // Desktop popover has no native focus restore, so return focus to the trigger
  // ourselves; the mobile sheet's <dialog> does it on close. Outside-click
  // dismissal skips this (focus has already moved off the trigger).
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    if (!isMobile) triggerRef.current?.focus();
  }, [isMobile]);

  const pick = useCallback(
    (next: FilterState) => {
      onSelect(next);
      close();
    },
    [onSelect, close],
  );

  // Desktop popover only: dismiss on outside click and focus the search on open.
  // The mobile sheet is a native <dialog> (focus-trap and ESC come for free).
  useEffect(() => {
    if (!open || isMobile) return;
    searchRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, isMobile]);

  const q = query.trim().toLowerCase();
  const showAll = q === "" || "all holdings".includes(q);
  const visibleAccounts = useMemo(
    () => accounts.filter((a) => a.payload.name.toLowerCase().includes(q)),
    [accounts, q],
  );
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(q)),
    [groups, q],
  );
  const noMatches = !showAll && visibleAccounts.length === 0 && visibleGroups.length === 0;

  // Desktop popover keyboard handling: ESC closes; arrows rove the scope options.
  const onPopoverKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const opts = Array.from(
      popoverRef.current?.querySelectorAll<HTMLButtonElement>("[data-scope-option]") ?? [],
    );
    if (opts.length === 0) return;
    const idx = opts.indexOf(document.activeElement as HTMLButtonElement);
    // From the search field (idx === -1), ArrowDown lands on the first option;
    // ArrowUp stays put rather than jumping to the last.
    if (e.key === "ArrowUp" && idx === -1) return;
    e.preventDefault();
    const nextIdx =
      e.key === "ArrowDown" ? (idx + 1) % opts.length : idx <= 0 ? opts.length - 1 : idx - 1;
    opts[nextIdx]?.focus();
  };

  const list = (
    <div>
      <h2 id={headingId} className="sr-only">
        Filter holdings by scope
      </h2>
      <div className="flex items-center gap-2.5 rounded-lg border border-line bg-vault px-3 py-2.5 mb-2 focus-within:border-accent-dim transition-colors">
        <Search size={15} className="text-faint shrink-0" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search accounts & groups"
          aria-label="Search accounts and groups"
          className="w-full bg-transparent text-sm text-cream placeholder:text-faint outline-none [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      {showAll && (
        <ScopeOption
          label="All holdings"
          count={totalCount}
          active={filter.kind === "all"}
          onPick={() => pick({ kind: "all" })}
        />
      )}

      {visibleAccounts.length > 0 && (
        <>
          <p className="font-mono text-[10px] tracking-label uppercase text-faint px-3 pt-2.5 pb-1">
            Accounts
          </p>
          {visibleAccounts.map((a) => (
            <ScopeOption
              key={a.id}
              label={a.payload.name}
              count={accountCounts.get(a.id) ?? 0}
              active={isActive(filter, { kind: "account", accountId: a.id })}
              onPick={() => pick({ kind: "account", accountId: a.id })}
            />
          ))}
        </>
      )}

      {visibleGroups.length > 0 && (
        <>
          <p className="font-mono text-[10px] tracking-label uppercase text-faint px-3 pt-2.5 pb-1">
            Groups
          </p>
          {visibleGroups.map((g) => (
            <ScopeOption
              key={g.id}
              label={g.name}
              count={groupCounts.get(g.id) ?? 0}
              active={isActive(filter, { kind: "group", groupId: g.id })}
              onPick={() => pick({ kind: "group", groupId: g.id })}
            />
          ))}
        </>
      )}

      {noMatches && <p className="text-sm text-dim px-3 py-3">No matching accounts or groups</p>}

      <div className="border-t border-line mt-1.5 pt-1.5">
        <button
          type="button"
          onClick={() => {
            close();
            onEditGroups();
          }}
          className="w-full flex items-center gap-2 text-left font-mono text-xs tracking-button uppercase text-faint px-3 py-2.5 rounded-md hover:bg-white/[0.03] hover:text-accent transition-colors cursor-pointer"
        >
          <span aria-hidden="true">&#8862;</span> Edit groups
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative inline-block">
      <h3 className="font-serif text-2xl font-normal tracking-[-0.005em]">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && open) close();
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="group inline-flex items-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded"
        >
          {label} &middot; {count}
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={`text-faint group-hover:text-accent transition-[color,transform] ${open ? "rotate-180 text-accent" : ""}`}
          />
        </button>
      </h3>

      {open && !isMobile && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby={headingId}
          onKeyDown={onPopoverKeyDown}
          className="absolute left-0 top-full z-30 mt-2 w-[320px] max-w-[calc(100vw-3rem)] rounded-xl border border-line bg-panel-2 p-1.5 shadow-[0_26px_52px_-18px_rgba(0,0,0,0.78)]"
        >
          {list}
        </div>
      )}

      {isMobile && (
        <Modal open={open} onClose={close} variant="sheet" labelledBy={headingId}>
          {list}
        </Modal>
      )}
    </div>
  );
}

function ScopeOption({
  label,
  count,
  active,
  onPick,
}: {
  label: string;
  count: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-scope-option
      onClick={onPick}
      aria-current={active ? "true" : undefined}
      className={`relative w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md text-left text-sm transition-colors cursor-pointer hover:bg-white/[0.03] ${
        active
          ? "text-accent before:absolute before:left-1 before:top-[7px] before:bottom-[7px] before:w-[2px] before:rounded before:bg-accent before:content-['']"
          : "text-cream-soft"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="font-mono text-xs text-dim tabular-nums shrink-0">{count}</span>
    </button>
  );
}
