import type { Decimal } from "@privance/core";
import type { TaxTreatment } from "./_constants";

export type { TaxTreatment };

export type TaxBucket = {
  key: TaxTreatment | "cash" | "property";
  label: string;
  valueCents: Decimal;
};

export type TaxBucketsResult = {
  buckets: TaxBucket[];
  /** Taxable + Cash: assets reachable before age 59-1/2 without penalty. */
  reachableBeforeFiftyNineHalfCents: Decimal;
};

export type IncomePayer = {
  /** Stable unique key: the price ticker for dividends, `cash:<accountId>` for interest. */
  id: string;
  /** Chip label: ticker for dividend payers, "CASH" for interest-bearing cash. */
  ticker: string;
  annualCents: Decimal;
  /** Forward yield as a ratio, e.g. 0.0137 for 1.37% (dividend yield or cash APY). */
  yield: number;
};

export type EstimatedIncomeResult = {
  annualCents: Decimal;
  /** Annual income / total market value, 0 when market value is zero. */
  portfolioYield: number;
  monthlyCents: Decimal;
  /** Top payers sorted desc by annualCents. */
  payers: IncomePayer[];
};
