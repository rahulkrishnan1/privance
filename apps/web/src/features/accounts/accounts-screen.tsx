"use client";

import type { Account, AccountKind, Decimal } from "@privance/core";
import { type ReactNode, useMemo, useState } from "react";
import { Button, ConfirmDialog, Screen } from "@/components/index";
import { useHoldingsQuery } from "@/features/holdings/queries";
import { getMarketValue } from "@/lib/market-value";
import { usePricesQuery } from "@/lib/queries/prices";
import { AccountForm } from "./components/account-form";
import { AccountSection } from "./components/account-section";
import { EmptyState } from "./components/empty-state";
import { SkeletonRow } from "./components/skeleton-row";
import { useCreateAccount, useDeleteAccount, useUpdateAccount } from "./mutations";
import { centsToDecimal, getBalanceCents, useAccountsQuery } from "./queries";
import { type AccountFormValues, KIND_META, SECTION_ORDER } from "./types";

// ---------------------------------------------------------------------------
// Modal state discriminated union
// ---------------------------------------------------------------------------

type DrawerState =
  | { mode: "closed" }
  | { mode: "add"; defaultKind: AccountKind }
  | { mode: "edit"; account: Account };

// ---------------------------------------------------------------------------
// AccountsScreen
// ---------------------------------------------------------------------------

export function AccountsScreen() {
  const query = useAccountsQuery();
  const { holdings } = useHoldingsQuery();
  const { create, state: createState } = useCreateAccount();
  const { update, state: updateState } = useUpdateAccount();
  const { deleteAccount } = useDeleteAccount();
  const [drawer, setDrawer] = useState<DrawerState>({ mode: "closed" });
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  const submitting = createState === "pending" || updateState === "pending";

  // Route tickers so holdings get a current price for investment-account totals.
  // Stock/proxy tickers go to Yahoo; crypto IDs go to CoinGecko.
  const { yahooTickers, coingeckoTickers } = useMemo(() => {
    const yahoo = new Set<string>();
    const coingecko = new Set<string>();
    for (const h of holdings) {
      if (h.proxyTicker !== null) yahoo.add(h.proxyTicker);
      else if (h.assetType === "crypto") coingecko.add(h.ticker);
      else yahoo.add(h.ticker);
    }
    return { yahooTickers: [...yahoo], coingeckoTickers: [...coingecko] };
  }, [holdings]);
  const { prices } = usePricesQuery({ yahooTickers, coingeckoTickers });
  const pricesMap = useMemo(() => {
    const m = new Map<string, { ticker: string; price: string }>();
    for (const [ticker, decimal] of prices) {
      m.set(ticker, { ticker, price: decimal.toString() });
    }
    return m;
  }, [prices]);

  // Investment-account total = cash sweep + sum of holdings' market value.
  const valuesByAccount = useMemo(() => {
    if (query.status !== "success") return new Map<string, Decimal>();
    const map = new Map<string, Decimal>();
    for (const account of query.data) {
      if (account.payload.kind !== "investment") continue;
      let total = centsToDecimal(getBalanceCents(account));
      for (const h of holdings) {
        if (h.accountId !== account.id) continue;
        total = total.add(getMarketValue(h, pricesMap));
      }
      map.set(account.id, total);
    }
    return map;
  }, [query, holdings, pricesMap]);

  function openAdd(kind: AccountKind = "cash") {
    setDrawer({ mode: "add", defaultKind: kind });
  }

  function openEdit(account: Account) {
    setDrawer({ mode: "edit", account });
  }

  function closeDrawer() {
    setDrawer({ mode: "closed" });
  }

  async function handleSubmit(values: AccountFormValues) {
    if (drawer.mode === "add") {
      await create({
        id: crypto.randomUUID(),
        name: values.name,
        kind: values.kind,
        currency: values.currency,
        balanceString: values.balance,
      });
    } else if (drawer.mode === "edit") {
      await update({
        account: drawer.account,
        name: values.name,
        currency: values.currency,
        balanceString: values.balance,
      });
    }
    closeDrawer();
  }

  async function handleDelete(account: Account) {
    await deleteAccount(account);
  }

  // The modal and confirm dialog are rendered once, below the body switch, so
  // they keep a single stable instance across the initialising -> empty -> list
  // transitions. Rendering the form inside a branch remounts it the moment the
  // account list first arrives (e.g. the opening sync flips empty -> list),
  // which destroys the form's internal state and silently wipes a half-typed
  // entry. A background sync tick must never clear a form the user is filling.
  let body: ReactNode;
  if (query.status === "initialising") {
    body = (
      <div className="flex flex-col gap-6">
        {SECTION_ORDER.map((kind) => (
          <div key={kind} className="flex flex-col gap-2">
            <div className="h-4 w-1/4 rounded bg-white/5 animate-pulse" />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ))}
      </div>
    );
  } else if (query.status === "error") {
    body = (
      <div className="flex flex-col gap-4 items-center py-8 px-4 rounded-xl border border-app-red/40 bg-app-red/10">
        <p className="text-base font-semibold text-app-red text-center">Could not load accounts</p>
        <p className="text-sm text-app-muted text-center">{query.error.message}</p>
        <Button
          variant="secondary"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          aria-label="Retry loading accounts"
        >
          Retry
        </Button>
      </div>
    );
  } else if (query.data.length === 0) {
    body = <EmptyState onAdd={() => openAdd()} />;
  } else {
    const byKind: Record<AccountKind, Account[]> = {
      cash: [],
      investment: [],
      manual_asset: [],
      liability: [],
    };
    for (const account of query.data) {
      byKind[account.payload.kind].push(account);
    }
    body = (
      <>
        {/* Page header */}
        <div className="flex justify-between items-center mb-4">
          <h1
            className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text"
            style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
          >
            Accounts
          </h1>
          <Button onClick={() => openAdd()} aria-label="Add a new account">
            Add account
          </Button>
        </div>

        {/* Sections */}
        <div className="flex flex-col gap-6">
          {SECTION_ORDER.map((kind) => (
            <AccountSection
              key={kind}
              meta={KIND_META[kind]}
              accounts={byKind[kind]}
              valuesByAccount={valuesByAccount}
              onEdit={openEdit}
              onDelete={(account) => setPendingDelete(account)}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <Screen width="wide">
      {body}

      {/* Add / Edit dialog, mounted once so it survives list re-renders */}
      <AccountForm
        open={drawer.mode !== "closed"}
        defaultKind={drawer.mode === "add" ? drawer.defaultKind : "cash"}
        {...(drawer.mode === "edit" ? { account: drawer.account } : {})}
        onClose={closeDrawer}
        onSubmit={handleSubmit}
        submitting={submitting}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete account?"
        body={
          pendingDelete !== null
            ? `Permanently delete "${pendingDelete.payload.name}"? Its balance will stop contributing to your net worth. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete === null) return;
          await handleDelete(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </Screen>
  );
}
