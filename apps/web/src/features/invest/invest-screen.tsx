"use client";

import { Decimal, type HoldingId, SCALE_CENTS } from "@privance/core";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AccountForm, percentToFraction, trimToUndefined } from "@/features/accounts";
import { useCreateAccount } from "@/features/accounts/mutations";
import { useAccountsQuery } from "@/features/accounts/queries";
import type { AccountFormValues } from "@/features/accounts/types";
import { deriveAggregateDeltas, useDashboardData } from "@/features/dashboard/queries";
import type { SymbolProfileEntry } from "@/lib/api/symbol-profiles";
import { taxBuckets } from "./_invest-math";
import { AccountsView } from "./components/accounts-view";
import { HoldingsView } from "./components/holdings-view";
import { InvestHero } from "./components/invest-hero";
import { InvestSubnav } from "./components/invest-subnav";
import { OverviewView } from "./components/overview-view";
import { OPEN_ADD_HOLDING_KEY } from "./types";

export type InvestView = "overview" | "holdings" | "accounts";

type InvestScreenProps = {
  view: InvestView;
};

const MAX_WIDTH = "max-w-[1120px] mx-auto px-7 max-[760px]:px-4";

export function InvestScreen({ view }: InvestScreenProps) {
  const router = useRouter();
  const dashData = useDashboardData();
  const accountsState = useAccountsQuery();
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  // Bumped by the subnav "+ holding" button; HoldingsView opens its add drawer
  // when this changes (the drawer + its save pipeline live inside HoldingsView).
  const [addHoldingSignal, setAddHoldingSignal] = useState(0);
  const { create, state: createState } = useCreateAccount();

  const accounts = accountsState.status === "success" ? accountsState.data : [];

  const taxBucketsResult = useMemo(() => {
    if (dashData.status !== "ready") {
      return { buckets: [], reachableBeforeFiftyNineHalfCents: Decimal.zero(SCALE_CENTS) };
    }
    return taxBuckets({ accounts, breakdown: dashData.breakdown });
  }, [accounts, dashData]);

  const netWorthDelta = useMemo(() => {
    if (dashData.status !== "ready") return null;
    const { netWorth } = deriveAggregateDeltas(dashData.breakdown, dashData.dayChangeByHoldingId);
    return netWorth ?? null;
  }, [dashData]);

  async function handleAddAccountSubmit(values: AccountFormValues) {
    await create({
      id: crypto.randomUUID(),
      name: values.name,
      kind: values.kind,
      currency: values.currency,
      balanceString: values.balance,
      subKind: values.subKind,
      apy: percentToFraction(values.apy),
      interestRate: percentToFraction(values.interestRate),
      termYears: trimToUndefined(values.termYears),
      valuedAt: trimToUndefined(values.valuedAt),
    });
    setAddAccountOpen(false);
  }

  const isEmpty =
    dashData.status === "empty" ||
    (accountsState.status === "success" && accountsState.data.length === 0);

  const breakdown = dashData.status === "ready" ? dashData.breakdown : null;
  const historyPoints = dashData.status === "ready" ? dashData.historyPoints : [];
  const holdings = dashData.status === "ready" ? dashData.holdings : [];
  const dayChangeByHoldingId: Map<HoldingId, Decimal> =
    dashData.status === "ready" ? dashData.dayChangeByHoldingId : new Map();
  const profilesByTicker: ReadonlyMap<string, SymbolProfileEntry> =
    dashData.status === "ready" ? dashData.profilesByTicker : new Map();

  return (
    <div className={MAX_WIDTH}>
      {isEmpty ? (
        <div className="text-center py-20 px-6">
          <div className="w-[84px] h-[84px] rounded-full border border-dashed border-cream/20 flex items-center justify-center text-accent mx-auto mb-7">
            <Plus size={30} strokeWidth={1.5} />
          </div>
          <h2 className="font-serif text-[32px] font-normal tracking-[-0.01em]">
            Your vault is empty, <span className="italic text-accent">and sealed.</span>
          </h2>
          <p className="text-dim max-w-[42ch] mx-auto mt-3 text-[14.5px]">
            Add your first account to start tracking net worth. Everything you enter is encrypted on
            this device before it is stored.
          </p>
          <button
            type="button"
            onClick={() => setAddAccountOpen(true)}
            className="inline-block mt-7 font-mono text-[11.5px] tracking-[.12em] uppercase bg-accent text-vault rounded-md px-[26px] py-3.5 cursor-pointer hover:bg-cream transition-colors"
          >
            Add first account
          </button>
        </div>
      ) : (
        <>
          {breakdown !== null && (
            <InvestHero breakdown={breakdown} delta={netWorthDelta} historyPoints={historyPoints} />
          )}

          {dashData.status === "loading" && (
            <div className="pt-11 pb-0">
              <div className="h-3 w-20 rounded bg-white/5 animate-pulse mb-4" />
              <div className="h-16 w-64 rounded bg-white/5 animate-pulse mb-2" />
              <div className="mt-8 h-[140px] rounded bg-white/5 animate-pulse" />
            </div>
          )}

          {/* Subnav: Overview / Holdings / Accounts. Overview and Holdings add a
              holding; Accounts adds an account. On Overview the holding drawer
              lives on the Holdings route, so route there and flag it to open. */}
          <InvestSubnav
            onAdd={
              view === "accounts"
                ? () => setAddAccountOpen(true)
                : view === "holdings"
                  ? () => setAddHoldingSignal((n) => n + 1)
                  : () => {
                      sessionStorage.setItem(OPEN_ADD_HOLDING_KEY, "1");
                      router.push("/app/holdings/");
                    }
            }
            addLabel={view === "accounts" ? "account" : "holding"}
          />

          {view === "overview" && breakdown !== null && (
            <OverviewView
              breakdown={breakdown}
              accounts={accounts}
              holdings={holdings}
              dayChangeByHoldingId={dayChangeByHoldingId}
              netWorthDelta={netWorthDelta}
              taxBucketsResult={taxBucketsResult}
              profilesByTicker={profilesByTicker}
            />
          )}

          {view === "holdings" && (
            <HoldingsView
              breakdown={breakdown}
              dayChangeByHoldingId={dayChangeByHoldingId}
              addSignal={addHoldingSignal}
            />
          )}

          {view === "accounts" && <AccountsView breakdown={breakdown} />}
        </>
      )}

      {/* Add-account form, mounted once outside the empty/populated branches so the
          empty -> populated flip (first sync settling) never remounts and wipes a
          half-filled form. Closed on holdings view, where "+ Add" adds a holding. */}
      <AccountForm
        open={addAccountOpen}
        defaultKind="investment"
        onClose={() => setAddAccountOpen(false)}
        onSubmit={handleAddAccountSubmit}
        submitting={createState === "pending"}
      />
    </div>
  );
}
