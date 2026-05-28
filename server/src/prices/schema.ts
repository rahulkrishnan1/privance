import { decimal, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const prices = pgTable(
  "prices",
  {
    source: text("source").notNull(),
    ticker: text("ticker").notNull(),
    price: decimal("price", { precision: 24, scale: 8 }).notNull(),
    // Equity: previous session close. Crypto: price 24h ago. Nullable when
    // upstream omits the field.
    previousPrice: decimal("previous_price", { precision: 24, scale: 8 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.ticker] })],
);
