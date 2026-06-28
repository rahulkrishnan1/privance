"use client";

import type {
  Account,
  AccountKind,
  Decimal,
  HoldingValuation,
  NetWorthBreakdown,
} from "@privance/core";
import { ChevronRight, CreditCard, Home, TrendingUp, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AccountForm,
  CASH_TYPE_LABEL,
  percentToFraction,
  trimToUndefined,
} from "@/features/accounts";
import { formatAccountBalanceWhole } from "@/features/accounts/balance";
import { useDeleteAccount, useUpdateAccount } from "@/features/accounts/mutations";
import { centsToDecimal, getBalanceCents, useAccountsQuery } from "@/features/accounts/queries";
import type { AccountFormValues } from "@/features/accounts/types";
import { SECTION_ORDER } from "@/features/accounts/types";
import { useHoldingsQuery } from "@/features/holdings/queries";
import { SUBKIND_TAG } from "../_constants";
import { AccountDetailSheet } from "./account-detail-sheet";

const SECTION_LABEL: Record<AccountKind, string> = {
  investment: "Brokerage",
  cash: "Cash",
  manual_asset: "Property & assets",
  liability: "Liabilities",
};

const KIND_ICONS: Record<AccountKind, typeof Wallet> = {
  cash: Wallet,
  investment: TrendingUp,
  manual_asset: Home,
  liability: CreditCard,
};

function formatShortMonthYear(isoDate: string): string {
  // Parse at local midnight so a yyyy-mm-dd value never drifts to the prior month.
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

function accountSubLine(account: Account, holdingsCount: number): string {
  switch (account.payload.kind) {
    case "investment": {
      const tag = SUBKIND_TAG[account.payload.subKind] ?? account.payload.subKind;
      const holdingsLabel = `${holdingsCount} holding${holdingsCount === 1 ? "" : "s"}`;
      return `${holdingsLabel} · ${tag}`;
    }
    case "cash": {
      const { apy, subKind } = account.payload;
      const typeLabel = CASH_TYPE_LABEL[subKind] ?? "Other";
      if (apy) {
        const apyPct = (Number(apy) * 100).toFixed(2);
        return `${typeLabel} · ${apyPct}% APY`;
      }
      return typeLabel;
    }
    case "manual_asset": {
      const { valuedAt } = account.payload;
      return valuedAt ? `valued ${formatShortMonthYear(valuedAt)}` : "asset";
    }
    case "liability": {
      const { interestRate, termYearsRemaining } = account.payload;
      const parts: string[] = [];
      if (interestRate) parts.push(`${(Number(interestRate) * 100).toFixed(2)}%`);
      if (termYearsRemaining) parts.push(`${Number(termYearsRemaining)}y left`);
      return parts.length > 0 ? parts.join(" · ") : "liability";
    }
  }
}

type AccountRowProps = {
  account: Account;
  displayValue: Decimal;
  holdingsCount: number;
  onClick: () => void;
};

function AccountRow({ account, displayValue, holdingsCount, onClick }: AccountRowProps) {
  const Icon = KIND_ICONS[account.payload.kind];
  const { text: balanceText, showNegative } = formatAccountBalanceWhole(account, displayValue);
  const isLiability = account.payload.kind === "liability";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3.5 glass rounded-[10px] px-5 py-[18px] text-left cursor-pointer hover:border-cream/20 hover:-translate-y-px transition-[border-color,transform] duration-200 motion-reduce:hover:translate-y-0 motion-reduce:transition-none"
      aria-label={`${account.payload.name}, ${balanceText}`}
    >
      <div
        className={[
          "w-[38px] h-[38px] rounded-[9px] bg-panel-2 border border-line flex items-center justify-center shrink-0",
          isLiability ? "text-down" : "text-accent",
        ].join(" ")}
      >
        <Icon size={17} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-cream truncate">{account.payload.name}</p>
        <p className="font-mono text-xs text-faint mt-[3px] truncate">
          {accountSubLine(account, holdingsCount)}
        </p>
      </div>

      <span
        className={[
          "vfig font-mono text-sm tabular-nums shrink-0",
          showNegative ? "text-down" : "text-cream",
        ].join(" ")}
      >
        {balanceText}
      </span>

      <ChevronRight size={14} className="text-faint shrink-0" />
    </button>
  );
}

type DrawerState = { mode: "closed" } | { mode: "edit"; account: Account };

type AccountsViewProps = {
  breakdown: NetWorthBreakdown | null;
};

export function AccountsView({ breakdown }: AccountsViewProps) {
  const query = useAccountsQuery();
  const { holdings } = useHoldingsQuery();
  const { update, state: updateState } = useUpdateAccount();
  const { deleteAccount } = useDeleteAccount();

  const [detailAccount, setDetailAccount] = useState<Account | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>({ mode: "closed" });

  const submitting = updateState === "pending";

  const holdingsCountByAccount = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      map.set(h.accountId, (map.get(h.accountId) ?? 0) + 1);
    }
    return map;
  }, [holdings]);

  // Per-account values come from the canonical net-worth breakdown (sweep +
  // holdings at market, already computed upstream), not a second price pipeline,
  // so every tab shows the same number for the same account.
  const valuesByAccount = useMemo(() => {
    const map = new Map<string, Decimal>();
    if (breakdown === null) return map;
    for (const av of breakdown.byAccount) map.set(av.accountId, av.value);
    return map;
  }, [breakdown]);

  const holdingValuationsForAccount = useMemo((): HoldingValuation[] => {
    if (detailAccount === null || breakdown === null) return [];
    return breakdown.byHolding.filter((hv) => {
      const holding = holdings.find((h) => h.id === hv.holdingId);
      return holding?.accountId === detailAccount.id;
    });
  }, [detailAccount, breakdown, holdings]);

  const holdingsByAccountForDetail = useMemo(() => {
    if (detailAccount === null || breakdown === null) return [];
    const mvByHoldingId = new Map<string, Decimal>(
      breakdown.byHolding.map((hv) => [hv.holdingId, hv.marketValue]),
    );
    return holdings
      .filter((h) => h.accountId === detailAccount.id)
      .map((h) => ({
        id: h.id,
        ticker: h.ticker,
        name: h.name,
        valueCents: mvByHoldingId.get(h.id) ?? centsToDecimal("0"),
      }));
  }, [detailAccount, breakdown, holdings]);

  const detailAccountValue = useMemo((): Decimal => {
    if (detailAccount === null) return centsToDecimal("0");
    return valuesByAccount.get(detailAccount.id) ?? centsToDecimal(getBalanceCents(detailAccount));
  }, [detailAccount, valuesByAccount]);

  async function handleSubmit(values: AccountFormValues) {
    if (drawer.mode !== "edit") return;
    const apyFraction = percentToFraction(values.apy);
    const rateFraction = percentToFraction(values.interestRate);
    const termYears = trimToUndefined(values.termYears);
    const valuedAt = trimToUndefined(values.valuedAt);
    await update({
      account: drawer.account,
      name: values.name,
      currency: values.currency,
      balanceString: values.balance,
      subKind: values.subKind,
      apy: values.apy !== undefined ? (apyFraction ?? "") : undefined,
      interestRate: values.interestRate !== undefined ? (rateFraction ?? "") : undefined,
      termYears: values.termYears !== undefined ? (termYears ?? "") : undefined,
      valuedAt: values.valuedAt !== undefined ? (valuedAt ?? "") : undefined,
    });
    setDrawer({ mode: "closed" });
  }

  if (query.status === "initialising") {
    return (
      <div className="pt-4">
        {[...Array(3)].map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
          <div key={i} className="h-[74px] rounded-[10px] bg-white/5 animate-pulse mb-2.5" />
        ))}
      </div>
    );
  }

  if (query.status === "error") {
    return (
      <div className="pt-4">
        <p className="text-sm text-down">{query.error.message}</p>
      </div>
    );
  }

  const accounts = query.data;
  const byKind: Record<AccountKind, Account[]> = {
    cash: [],
    investment: [],
    manual_asset: [],
    liability: [],
  };
  for (const account of accounts) {
    byKind[account.payload.kind].push(account);
  }

  const displayValueFor = (account: Account): Decimal =>
    valuesByAccount.get(account.id) ?? centsToDecimal(getBalanceCents(account));
  const renderedSections = SECTION_ORDER.map((kind) => ({
    kind,
    accounts: [...byKind[kind]].sort((a, b) => displayValueFor(b).cmp(displayValueFor(a))),
  })).filter((section) => section.accounts.length > 0);

  return (
    <div className="pt-4">
      {renderedSections.map(({ kind, accounts: sectionAccounts }, sectionIndex) => (
        <div key={kind} className={sectionIndex > 0 ? "mt-4" : ""}>
          <p className="font-mono text-xs tracking-label uppercase text-faint pb-2.5">
            {SECTION_LABEL[kind]}
          </p>
          <div className="flex flex-col gap-2.5">
            {sectionAccounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                displayValue={displayValueFor(account)}
                holdingsCount={holdingsCountByAccount.get(account.id) ?? 0}
                onClick={() => setDetailAccount(account)}
              />
            ))}
          </div>
        </div>
      ))}

      {accounts.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-cream-soft text-base mb-1">No accounts yet</p>
          <p className="font-mono text-xs text-faint">
            Add an account to start tracking your net worth.
          </p>
        </div>
      )}

      {detailAccount !== null && (
        <AccountDetailSheet
          account={detailAccount}
          totalValue={detailAccountValue}
          holdingValuations={holdingValuationsForAccount}
          holdingsByAccount={holdingsByAccountForDetail}
          onClose={() => setDetailAccount(null)}
          onEdit={(account) => {
            setDetailAccount(null);
            setDrawer({ mode: "edit", account });
          }}
          onDelete={async (account) => {
            await deleteAccount(account);
          }}
        />
      )}

      <AccountForm
        open={drawer.mode !== "closed"}
        defaultKind="cash"
        {...(drawer.mode === "edit" ? { account: drawer.account } : {})}
        onClose={() => setDrawer({ mode: "closed" })}
        onSubmit={handleSubmit}
        submitting={submitting}
      />
    </div>
  );
}
