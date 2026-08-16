import { Plus } from "lucide-react";
import { Outlet } from "react-router";
import { AccountForm, percentToFraction, trimToUndefined } from "@/features/accounts";
import { useCreateAccount } from "@/features/accounts/mutations";
import { useAccountsQuery } from "@/features/accounts/queries";
import type { AccountFormValues } from "@/features/accounts/types";
import { InvestHero } from "./components/invest-hero";
import { InvestSubnav } from "./components/invest-subnav";
import { InvestDashboardProvider, useInvestDashboard } from "./invest-context";

const MAX_WIDTH = "max-w-[1120px] mx-auto px-7 max-[760px]:px-4";

export function InvestLayout() {
  return (
    <div className={MAX_WIDTH}>
      <InvestDashboardProvider>
        <InvestLayoutInner />
      </InvestDashboardProvider>
    </div>
  );
}

function InvestLayoutInner() {
  const { dashData, addAccountOpen, openAddAccount, closeAddAccount } = useInvestDashboard();
  const accountsState = useAccountsQuery();
  const { create, state: createState } = useCreateAccount();

  const isEmpty =
    dashData.status === "empty" ||
    (accountsState.status === "success" && accountsState.data.length === 0);

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
    closeAddAccount();
  }

  // Derive hero props + skeleton visibility from the shared dashData.
  const breakdown = dashData.status === "ready" ? dashData.breakdown : null;
  const historyPoints = dashData.status === "ready" ? dashData.historyPoints : [];

  const netWorthDelta = dashData.status === "ready" ? dashData.netWorthDelta : null;

  return (
    <>
      {isEmpty ? (
        <div className="text-center py-20 px-6">
          <div className="w-[84px] h-[84px] rounded-full border border-dashed border-cream/20 flex items-center justify-center text-accent mx-auto mb-7">
            <Plus size={30} strokeWidth={1.5} />
          </div>
          <h2 className="font-serif text-4xl font-normal tracking-[-0.01em]">
            Your vault is empty, <span className="italic text-accent">and sealed.</span>
          </h2>
          <p className="text-dim max-w-[42ch] mx-auto mt-3 text-base">
            Add your first account to start tracking net worth. Everything you enter is encrypted on
            this device before it is stored.
          </p>
          <button
            type="button"
            onClick={openAddAccount}
            className="inline-block mt-7 font-mono text-xs tracking-button uppercase bg-accent text-vault rounded-md px-[26px] py-3.5 cursor-pointer hover:bg-cream transition ease-out duration-150 active:scale-[0.97] motion-reduce:active:scale-100"
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
            <div className="pt-6 pb-0">
              <div className="h-3 w-20 rounded skeleton mb-4" />
              <div className="h-16 w-64 rounded skeleton mb-2" />
              <div className="mt-8 h-[140px] rounded skeleton" />
            </div>
          )}

          {/* Subnav derives its onAdd from active route + context; no props needed. */}
          <InvestSubnav />

          <Outlet />
        </>
      )}

      {/* Add-account form, mounted once outside the empty/populated branches so the
          empty -> populated flip (first sync settling) never remounts and wipes a
          half-filled form. */}
      <AccountForm
        open={addAccountOpen}
        defaultKind="investment"
        onClose={closeAddAccount}
        onSubmit={handleAddAccountSubmit}
        submitting={createState === "pending"}
      />
    </>
  );
}
