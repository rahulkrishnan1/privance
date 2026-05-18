import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../core/db.js";
import { prices } from "./schema.js";

export type CachedPriceRow = {
  source: string;
  ticker: string;
  price: string;
  fetchedAt: Date;
};

export class PricesRepo {
  constructor(private readonly db: Db) {}

  async getMany(opts: { source: string; tickers: string[] }): Promise<CachedPriceRow[]> {
    const { source, tickers } = opts;
    if (tickers.length === 0) return [];

    const rows = await this.db
      .select()
      .from(prices)
      .where(and(eq(prices.source, source), inArray(prices.ticker, tickers)));

    return rows.map((r) => ({
      source: r.source,
      ticker: r.ticker,
      price: r.price,
      fetchedAt: r.fetchedAt,
    }));
  }

  async upsertMany(rows: CachedPriceRow[]): Promise<void> {
    if (rows.length === 0) return;

    await this.db
      .insert(prices)
      .values(rows)
      .onConflictDoUpdate({
        target: [prices.source, prices.ticker],
        set: {
          price: sql`excluded.price`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }
}

export function createPricesRepo(db: Db): PricesRepo {
  return new PricesRepo(db);
}
