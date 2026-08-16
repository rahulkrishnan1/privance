import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { DashboardData } from "@/features/dashboard/queries";
import { useDashboardData } from "@/features/dashboard/queries";

export type InvestDashboardContext = {
  /** Full dashboard pipeline (decrypt + compute), run once per layout mount.
   *  Four consumers (hero + 3 views) share this single evaluation. */
  dashData: DashboardData;
  /** Incremented by the subnav "+ holding" button; HoldingsView opens its add
   *  drawer in response. Living here lets Outlet children react to a signal
   *  they cannot receive as props. */
  addHoldingSignal: number;
  bumpAddHolding: () => void;
  consumeAddHoldingSignal: (signal: number) => boolean;
  /** Opens the add-account form (mounted in invest-layout). */
  addAccountOpen: boolean;
  openAddAccount: () => void;
  closeAddAccount: () => void;
};

const Ctx = createContext<InvestDashboardContext | null>(null);

export function InvestDashboardProvider({ children }: { children: React.ReactNode }) {
  // useDashboardData is NOT a TanStack Query hook — it decrypts + computes
  // the full net-worth breakdown from the local store. Running it once and
  // sharing via context avoids re-decrypting on every tab switch.
  const dashData = useDashboardData();

  const [addHoldingSignal, setAddHoldingSignal] = useState(0);
  const consumedAddHoldingSignalRef = useRef(0);
  const bumpAddHolding = useCallback(() => setAddHoldingSignal((n) => n + 1), []);
  const consumeAddHoldingSignal = useCallback((signal: number): boolean => {
    if (signal <= consumedAddHoldingSignalRef.current) return false;
    consumedAddHoldingSignalRef.current = signal;
    return true;
  }, []);

  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const openAddAccount = useCallback(() => setAddAccountOpen(true), []);
  const closeAddAccount = useCallback(() => setAddAccountOpen(false), []);

  const value = useMemo<InvestDashboardContext>(
    () => ({
      dashData,
      addHoldingSignal,
      bumpAddHolding,
      consumeAddHoldingSignal,
      addAccountOpen,
      openAddAccount,
      closeAddAccount,
    }),
    [
      dashData,
      addHoldingSignal,
      bumpAddHolding,
      consumeAddHoldingSignal,
      addAccountOpen,
      openAddAccount,
      closeAddAccount,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInvestDashboard(): InvestDashboardContext {
  const ctx = useContext(Ctx);
  if (ctx === null) {
    throw new Error("useInvestDashboard must be used within an InvestDashboardProvider");
  }
  return ctx;
}
