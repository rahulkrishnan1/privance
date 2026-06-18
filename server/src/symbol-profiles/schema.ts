import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const symbolProfiles = pgTable("symbol_profiles", {
  ticker: text("ticker").primaryKey(),
  assetType: text("asset_type").notNull(),
  displayName: text("display_name"),
  figi: text("figi"),
  cusip: text("cusip"),
  isin: text("isin"),
  assetClass: text("asset_class"),
  assetSubClass: text("asset_sub_class"),
  sector: text("sector"),
  // JSON array of { sector, weight } for funds; null for single-sector equities.
  sectorWeightings: text("sector_weightings"),
  industry: text("industry"),
  dividendYield: text("dividend_yield"),
  fundCategory: text("fund_category"),
  country: text("country"),
  region: text("region"),
  currency: text("currency"),
  exchange: text("exchange"),
  lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }).notNull().defaultNow(),
});
