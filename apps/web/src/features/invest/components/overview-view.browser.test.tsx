import type { NetWorthBreakdown } from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";

type TestDashboardData = {
  status: "ready";
  breakdown: NetWorthBreakdown | null;
  holdings: never[];
  dayChangeByHoldingId: Map<string, Decimal>;
  profilesByTicker: Map<string, never>;
  netWorthDelta: { dollar: Decimal; pct: number } | null;
};
const { dashboardData } = vi.hoisted(() => ({
  dashboardData: {
    status: "ready" as const,
    breakdown: null as NetWorthBreakdown | null,
    holdings: [],
    dayChangeByHoldingId: new Map<string, Decimal>(),
    profilesByTicker: new Map<string, never>(),
    netWorthDelta: null as TestDashboardData["netWorthDelta"],
  } satisfies TestDashboardData,
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/features/accounts/queries", () => ({
  useAccountsQuery: () => ({ status: "success", data: [] }),
}));
vi.mock("@/features/dashboard/components/allocation-pie", () => ({
  AllocationPie: () => null,
}));
vi.mock("@/features/dashboard/components/skeletons", () => ({
  AllocationPieSkeleton: () => null,
}));
vi.mock("@/features/dashboard/components/top-holdings-table", () => ({
  TopHoldingsTable: () => null,
}));
vi.mock("../_invest-math", () => ({
  buildClassSlices: () => [],
  buildSectorSlices: () => [],
  estimatedIncome: () => null,
  portfolioGain: () => ({ gainCents: Decimal.zero(SCALE_CENTS), gainPct: 0 }),
  taxBuckets: () => ({ buckets: [], reachableBeforeFiftyNineHalfCents: Decimal.zero(SCALE_CENTS) }),
}));
vi.mock("../invest-context", () => ({
  useInvestDashboard: () => ({ dashData: dashboardData }),
}));
vi.mock("./income-panel", () => ({ IncomePanel: () => null }));
vi.mock("./splits-row", () => ({
  SplitsRow: ({ delta }: { delta: { dollar: Decimal; pct: number } | null }) => (
    <output data-testid="today-delta">{delta?.dollar.toString() ?? "null"}</output>
  ),
}));
vi.mock("./tax-buckets-panel", () => ({ TaxBucketsPanel: () => null }));

import { OverviewView } from "./overview-view";

const breakdown = {
  totalAssets: Decimal.fromMinorUnits(100_000n, SCALE_CENTS),
  totalLiabilities: Decimal.zero(SCALE_CENTS),
  netWorth: Decimal.fromMinorUnits(100_000n, SCALE_CENTS),
  byAccountKind: {
    cash: Decimal.zero(SCALE_CENTS),
    investment: Decimal.fromMinorUnits(100_000n, SCALE_CENTS),
    liability: Decimal.zero(SCALE_CENTS),
    manualAsset: Decimal.zero(SCALE_CENTS),
  },
  byAccount: [],
  byHolding: [],
  unknownTickers: [],
  asOf: 0,
} as NetWorthBreakdown;

test("passes the dashboard net-worth delta to the Today tile", async () => {
  dashboardData.status = "ready";
  dashboardData.breakdown = breakdown;
  dashboardData.holdings = [];
  dashboardData.dayChangeByHoldingId = new Map<string, Decimal>();
  dashboardData.profilesByTicker = new Map<string, never>();
  dashboardData.netWorthDelta = {
    dollar: Decimal.fromMinorUnits(1234n, SCALE_CENTS),
    pct: 0.01234,
  };

  const screen = await render(<OverviewView />);

  await expect.element(screen.getByTestId("today-delta")).toHaveTextContent("12.34");
});
