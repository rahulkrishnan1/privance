"use client";

import type { InvestmentAccount } from "@privance/core";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  const pick = useCallback(
    (next: FilterState) => {
      onSelect(next);
      onOpenChange(false);
    },
    [onSelect, onOpenChange],
  );

  // Desktop renders a Popover, mobile a Dialog. If the viewport crosses the
  // breakpoint while the menu is open, close it so `open` can't strand itself on
  // the freshly-swapped primitive.
  const prevMobile = useRef(isMobile);
  useEffect(() => {
    if (prevMobile.current === isMobile) return;
    prevMobile.current = isMobile;
    onOpenChange(false);
  }, [isMobile, onOpenChange]);

  const body = (
    <Command>
      {!isMobile && (
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search accounts & groups"
          aria-label="Search accounts and groups"
        />
      )}
      <CommandList>
        <CommandEmpty>No matching accounts or groups</CommandEmpty>
        <CommandGroup>
          <ScopeItem
            value="all"
            label="All holdings"
            count={totalCount}
            active={filter.kind === "all"}
            onPick={() => pick({ kind: "all" })}
          />
        </CommandGroup>
        {accounts.length > 0 && (
          <CommandGroup heading="Accounts">
            {accounts.map((a) => (
              <ScopeItem
                key={a.id}
                value={a.id}
                label={a.payload.name}
                count={accountCounts.get(a.id) ?? 0}
                active={isActive(filter, { kind: "account", accountId: a.id })}
                onPick={() => pick({ kind: "account", accountId: a.id })}
              />
            ))}
          </CommandGroup>
        )}
        {groups.length > 0 && (
          <CommandGroup heading="Groups">
            {groups.map((g) => (
              <ScopeItem
                key={g.id}
                value={g.id}
                label={g.name}
                count={groupCounts.get(g.id) ?? 0}
                active={isActive(filter, { kind: "group", groupId: g.id })}
                onPick={() => pick({ kind: "group", groupId: g.id })}
              />
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <div className="mt-1.5 border-t border-line pt-1.5">
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onEditGroups();
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-left font-mono text-xs uppercase tracking-button text-faint transition-colors hover:bg-white/[0.03] hover:text-accent"
        >
          <span aria-hidden="true">&#8862;</span> Edit groups
        </button>
      </div>
    </Command>
  );

  const trigger = (
    <button
      type="button"
      className="group inline-flex items-center gap-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded"
    >
      {label} &middot; {count}
      <ChevronDown
        size={18}
        aria-hidden="true"
        className={`text-faint transition-[color,transform] group-hover:text-accent ${open ? "rotate-180 text-accent" : ""}`}
      />
    </button>
  );

  return (
    <h3 className="inline-block font-serif text-2xl font-normal tracking-[-0.005em]">
      {isMobile ? (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogTrigger asChild>{trigger}</DialogTrigger>
          <DialogContent aria-label="Filter holdings by scope">
            <DialogTitle className="sr-only">Filter holdings by scope</DialogTitle>
            {body}
          </DialogContent>
        </Dialog>
      ) : (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            aria-label="Filter holdings by scope"
            align="start"
            sideOffset={8}
            className="w-[320px] max-w-[calc(100vw-3rem)] rounded-xl p-1.5 shadow-[0_26px_52px_-18px_rgba(0,0,0,0.78)]"
          >
            {body}
          </PopoverContent>
        </Popover>
      )}
    </h3>
  );
}

function ScopeItem({
  value,
  label,
  count,
  active,
  onPick,
}: {
  value: string;
  label: string;
  count: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    // value is the unique scope id (names can collide); keywords keeps search by name.
    <CommandItem
      value={value}
      keywords={[label]}
      onSelect={onPick}
      aria-current={active ? "true" : undefined}
      className={
        active
          ? "text-accent before:absolute before:left-1 before:top-[7px] before:bottom-[7px] before:w-[2px] before:rounded before:bg-accent before:content-['']"
          : undefined
      }
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 font-mono text-xs tabular-nums text-dim">{count}</span>
    </CommandItem>
  );
}
