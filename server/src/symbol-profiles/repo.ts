import { inArray, sql } from "drizzle-orm";
import type { Db } from "../core/db.js";
import { symbolProfiles } from "./schema.js";
import type { SymbolProfile } from "./types.js";

type Row = typeof symbolProfiles.$inferSelect;

function parseSectorWeightings(raw: string | null): SymbolProfile["sectorWeightings"] {
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rowToProfile(row: Row): SymbolProfile {
  return {
    ticker: row.ticker,
    // The DB stores the string literal; cast is safe at the I/O boundary.
    assetType: row.assetType as SymbolProfile["assetType"],
    displayName: row.displayName ?? undefined,
    figi: row.figi ?? undefined,
    cusip: row.cusip ?? undefined,
    isin: row.isin ?? undefined,
    assetClass: row.assetClass ?? undefined,
    assetSubClass: row.assetSubClass ?? undefined,
    sector: row.sector ?? undefined,
    sectorWeightings: parseSectorWeightings(row.sectorWeightings),
    industry: row.industry ?? undefined,
    dividendYield: row.dividendYield ?? undefined,
    fundCategory: row.fundCategory ?? undefined,
    country: row.country ?? undefined,
    region: row.region ?? undefined,
    currency: row.currency ?? undefined,
    exchange: row.exchange ?? undefined,
  };
}

export class SymbolProfileRepo {
  constructor(private readonly db: Db) {}

  /** Returns cached profiles for the given tickers; absent tickers are omitted. */
  async getMany(opts: { tickers: string[] }): Promise<Map<string, SymbolProfile>> {
    const { tickers } = opts;
    if (tickers.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(symbolProfiles)
      .where(inArray(symbolProfiles.ticker, tickers));

    const out = new Map<string, SymbolProfile>();
    for (const row of rows) {
      out.set(row.ticker, rowToProfile(row));
    }
    return out;
  }

  /**
   * Upserts a batch of profiles, refreshing lastRefreshedAt for existing rows.
   * Idempotent, safe to call with the same profiles repeatedly.
   */
  async upsertMany(opts: { profiles: SymbolProfile[] }): Promise<void> {
    const { profiles } = opts;
    if (profiles.length === 0) return;

    const values = profiles.map((p) => ({
      ticker: p.ticker,
      assetType: p.assetType,
      displayName: p.displayName ?? null,
      figi: p.figi ?? null,
      cusip: p.cusip ?? null,
      isin: p.isin ?? null,
      assetClass: p.assetClass ?? null,
      assetSubClass: p.assetSubClass ?? null,
      sector: p.sector ?? null,
      sectorWeightings:
        p.sectorWeightings && p.sectorWeightings.length > 0
          ? JSON.stringify(p.sectorWeightings)
          : null,
      industry: p.industry ?? null,
      dividendYield: p.dividendYield ?? null,
      fundCategory: p.fundCategory ?? null,
      country: p.country ?? null,
      region: p.region ?? null,
      currency: p.currency ?? null,
      exchange: p.exchange ?? null,
    }));

    await this.db
      .insert(symbolProfiles)
      .values(values)
      .onConflictDoUpdate({
        target: symbolProfiles.ticker,
        set: {
          assetType: sql`excluded.asset_type`,
          displayName: sql`excluded.display_name`,
          figi: sql`excluded.figi`,
          cusip: sql`excluded.cusip`,
          isin: sql`excluded.isin`,
          assetClass: sql`excluded.asset_class`,
          assetSubClass: sql`excluded.asset_sub_class`,
          sector: sql`excluded.sector`,
          // Supplementary fields come from a secondary upstream fetch that is
          // often rate-limited; keep a stored value when this refresh omits it.
          sectorWeightings: sql`COALESCE(excluded.sector_weightings, ${symbolProfiles.sectorWeightings})`,
          industry: sql`excluded.industry`,
          dividendYield: sql`COALESCE(excluded.dividend_yield, ${symbolProfiles.dividendYield})`,
          fundCategory: sql`COALESCE(excluded.fund_category, ${symbolProfiles.fundCategory})`,
          country: sql`excluded.country`,
          region: sql`excluded.region`,
          currency: sql`excluded.currency`,
          exchange: sql`excluded.exchange`,
          lastRefreshedAt: sql`now()`,
        },
      });
  }

  /** Removes profiles by ticker (for testing and admin use). */
  async deleteMany(opts: { tickers: string[] }): Promise<void> {
    const { tickers } = opts;
    if (tickers.length === 0) return;
    await this.db.delete(symbolProfiles).where(inArray(symbolProfiles.ticker, tickers));
  }
}

export type { SymbolProfile };
