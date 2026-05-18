import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { PricesRepo } from "./repo.js";

// ---------------------------------------------------------------------------
// Integration tests for PricesRepo against a real Postgres instance.
// DATABASE_URL is read from the .env file (same dev DB used by the server).
// Tests clean up their own rows before each run so they are order-independent.
// ---------------------------------------------------------------------------

const TEST_SOURCE_A = "yahoo";
const TEST_SOURCE_B = "coingecko";
const TEST_TICKER = "REPO_TEST_VOO";
const TEST_TICKER_2 = "REPO_TEST_SPY";

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://privance:privance@localhost:5432/privance",
);
const db = drizzle(sql);
const repo = new PricesRepo(db);

async function cleanTestRows(): Promise<void> {
  await sql`
    DELETE FROM prices
    WHERE ticker IN (${TEST_TICKER}, ${TEST_TICKER_2})
      AND source IN (${TEST_SOURCE_A}, ${TEST_SOURCE_B})
  `;
}

beforeAll(async () => {
  await cleanTestRows();
});

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await sql.end();
});

// ---------------------------------------------------------------------------
// getMany
// ---------------------------------------------------------------------------

describe("PricesRepo.getMany", () => {
  it("returns [] for empty tickers", async () => {
    const result = await repo.getMany({ source: TEST_SOURCE_A, tickers: [] });
    expect(result).toEqual([]);
  });

  it("returns [] when no matching rows exist", async () => {
    const result = await repo.getMany({ source: TEST_SOURCE_A, tickers: [TEST_TICKER] });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// upsertMany
// ---------------------------------------------------------------------------

describe("PricesRepo.upsertMany", () => {
  it("is a no-op when rows is empty", async () => {
    await expect(repo.upsertMany([])).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// round-trip: insert then read back
// ---------------------------------------------------------------------------

describe("PricesRepo round-trip", () => {
  it("upsertMany then getMany returns the inserted row with exact values", async () => {
    const fetchedAt = new Date("2025-01-15T12:00:00.000Z");
    await repo.upsertMany([
      { source: TEST_SOURCE_A, ticker: TEST_TICKER, price: "182.34500000", fetchedAt },
    ]);

    const rows = await repo.getMany({ source: TEST_SOURCE_A, tickers: [TEST_TICKER] });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.source).toBe(TEST_SOURCE_A);
    expect(row?.ticker).toBe(TEST_TICKER);
    // Postgres numeric preserves significant digits; the decimal string must
    // represent the same value (exact string depends on server formatting).
    expect(parseFloat(row?.price ?? "0")).toBeCloseTo(182.345, 3);
    expect(row?.fetchedAt.toISOString()).toBe(fetchedAt.toISOString());
  });

  it("upsert overwrites: second upsert wins on price and fetchedAt", async () => {
    const first = new Date("2025-01-15T10:00:00.000Z");
    const second = new Date("2025-01-15T11:00:00.000Z");

    await repo.upsertMany([
      { source: TEST_SOURCE_A, ticker: TEST_TICKER, price: "100.00000000", fetchedAt: first },
    ]);
    await repo.upsertMany([
      { source: TEST_SOURCE_A, ticker: TEST_TICKER, price: "200.00000000", fetchedAt: second },
    ]);

    const rows = await repo.getMany({ source: TEST_SOURCE_A, tickers: [TEST_TICKER] });
    expect(rows).toHaveLength(1);
    expect(parseFloat(rows[0]?.price ?? "0")).toBeCloseTo(200, 0);
    expect(rows[0]?.fetchedAt.toISOString()).toBe(second.toISOString());
  });
});

// ---------------------------------------------------------------------------
// multi-source isolation
// ---------------------------------------------------------------------------

describe("PricesRepo multi-source isolation", () => {
  it("getMany by source only returns rows for that source", async () => {
    const fetchedAt = new Date("2025-01-15T12:00:00.000Z");
    await repo.upsertMany([
      { source: TEST_SOURCE_A, ticker: TEST_TICKER, price: "400.00000000", fetchedAt },
      { source: TEST_SOURCE_B, ticker: TEST_TICKER, price: "999.00000000", fetchedAt },
    ]);

    const yahooRows = await repo.getMany({ source: TEST_SOURCE_A, tickers: [TEST_TICKER] });
    expect(yahooRows).toHaveLength(1);
    expect(yahooRows[0]?.source).toBe(TEST_SOURCE_A);
    expect(parseFloat(yahooRows[0]?.price ?? "0")).toBeCloseTo(400, 0);

    const cgRows = await repo.getMany({ source: TEST_SOURCE_B, tickers: [TEST_TICKER] });
    expect(cgRows).toHaveLength(1);
    expect(cgRows[0]?.source).toBe(TEST_SOURCE_B);
    expect(parseFloat(cgRows[0]?.price ?? "0")).toBeCloseTo(999, 0);
  });
});
