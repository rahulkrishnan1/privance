import { describe, expect, it, mock } from "bun:test";

import { auditEvents, sessions, users } from "../auth/schema.js";
import { syncObjects } from "../sync/schema.js";

mock.module("../core/db.js", () => ({ db: {} }));

const { AccountRepo } = await import("./repo.js");

// A fake Drizzle handle that records every delete(table) issued inside a
// transaction, so we can assert the cascade hits every per-user table, in
// FK-safe order, and never touches global tables.
type FakeTx = {
  delete: (table: unknown) => { where: (cond: unknown) => Promise<undefined> };
};

function makeFakeDb() {
  const deletes: { table: unknown; scoped: boolean }[] = [];
  let inTransaction = false;
  const tx: FakeTx = {
    delete(table: unknown) {
      const entry = { table, scoped: false };
      deletes.push(entry);
      return {
        where: (cond: unknown) => {
          // A real cascade must scope every delete; an unscoped
          // `DELETE FROM table` (no where) would wipe other users too.
          entry.scoped = cond !== undefined && cond !== null;
          return Promise.resolve(undefined);
        },
      };
    },
  };
  const db = {
    async transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
      inTransaction = true;
      return fn(tx);
    },
  };
  return {
    db,
    deletes,
    deletedTables: () => deletes.map((d) => d.table),
    wasTransaction: () => inTransaction,
  };
}

describe("AccountRepo.destroyUser", () => {
  it("deletes every per-user table inside one transaction, FK children first", async () => {
    const fake = makeFakeDb();
    const repo = new AccountRepo(fake.db as never);

    await repo.destroyUser({ userId: "user-1" });

    expect(fake.wasTransaction()).toBe(true);
    expect(fake.deletedTables()).toEqual([syncObjects, auditEvents, sessions, users]);
    // users (the FK parent) is deleted last.
    expect(fake.deletedTables()[3]).toBe(users);
  });

  it("scopes every delete with a where clause so other users are untouched", async () => {
    const fake = makeFakeDb();
    const repo = new AccountRepo(fake.db as never);

    await repo.destroyUser({ userId: "user-1" });

    expect(fake.deletes).toHaveLength(4);
    expect(fake.deletes.every((d) => d.scoped)).toBe(true);
  });

  it("does not touch global tables (prices, symbol_profiles)", async () => {
    const fake = makeFakeDb();
    const repo = new AccountRepo(fake.db as never);

    await repo.destroyUser({ userId: "user-1" });

    expect(fake.deletedTables()).toHaveLength(4);
  });
});

describe("AccountRepo.getUserAuthHashById", () => {
  it("returns the stored auth hash for the user", async () => {
    const stored = Buffer.from("stored-hash");
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ authHashHash: stored }],
          }),
        }),
      }),
    };
    const repo = new AccountRepo(db as never);
    const result = await repo.getUserAuthHashById({ userId: "user-1" });
    expect(result).toBe(stored);
  });

  it("returns null when the user does not exist", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };
    const repo = new AccountRepo(db as never);
    const result = await repo.getUserAuthHashById({ userId: "ghost" });
    expect(result).toBeNull();
  });
});
