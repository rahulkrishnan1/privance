"use client";

import type { Account, AccountKind } from "@privance/core";
import { useState } from "react";
import { Button, ConfirmDialog, Screen } from "@/components/index";
import { AccountForm } from "./components/account-form";
import { AccountSection } from "./components/account-section";
import { EmptyState } from "./components/empty-state";
import { SkeletonRow } from "./components/skeleton-row";
import { useCreateAccount, useDeleteAccount, useUpdateAccount } from "./mutations";
import { useAccountsQuery } from "./queries";
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
  const { create, state: createState } = useCreateAccount();
  const { update, state: updateState } = useUpdateAccount();
  const { deleteAccount } = useDeleteAccount();
  const [drawer, setDrawer] = useState<DrawerState>({ mode: "closed" });
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  const submitting = createState === "pending" || updateState === "pending";

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

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (query.status === "initialising") {
    return (
      <Screen width="wide">
        <div className="flex flex-col gap-6">
          {SECTION_ORDER.map((kind) => (
            <div key={kind} className="flex flex-col gap-2">
              <div className="h-4 w-1/4 rounded bg-white/5 animate-pulse" />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ))}
        </div>
      </Screen>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (query.status === "error") {
    return (
      <Screen width="wide">
        <div className="flex flex-col gap-4 items-center py-8 px-4 rounded-xl border border-app-red/40 bg-app-red/10">
          <p className="text-base font-semibold text-app-red text-center">
            Could not load accounts
          </p>
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
      </Screen>
    );
  }

  const accounts = query.data;

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  if (accounts.length === 0) {
    return (
      <Screen width="wide">
        <EmptyState onAdd={() => openAdd()} />
        <AccountForm
          open={drawer.mode !== "closed"}
          defaultKind={drawer.mode === "add" ? drawer.defaultKind : "cash"}
          {...(drawer.mode === "edit" ? { account: drawer.account } : {})}
          onClose={closeDrawer}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      </Screen>
    );
  }

  // ---------------------------------------------------------------------------
  // Main list, grouped by kind in SECTION_ORDER
  // ---------------------------------------------------------------------------
  const byKind: Record<AccountKind, Account[]> = {
    cash: [],
    investment: [],
    manual_asset: [],
    liability: [],
  };
  for (const account of accounts) {
    byKind[account.payload.kind].push(account);
  }

  return (
    <Screen width="wide">
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
            kind={kind}
            meta={KIND_META[kind]}
            accounts={byKind[kind]}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={(account) => setPendingDelete(account)}
          />
        ))}
      </div>

      {/* Add / Edit dialog */}
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
