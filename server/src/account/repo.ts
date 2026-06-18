import { eq } from "drizzle-orm";

import { purgeUserData as purgeAuthData } from "../auth/index.js";
import { users } from "../auth/schema.js";
import type { Db } from "../core/db.js";
import { purgeUserData as purgeSyncData } from "../sync/index.js";

export class AccountRepo {
  constructor(private readonly db: Db) {}

  async getUserAuthHashById(opts: { userId: string }): Promise<Buffer | null> {
    const rows = await this.db
      .select({ authHashHash: users.authHashHash })
      .from(users)
      .where(eq(users.userId, opts.userId))
      .limit(1);
    return rows[0]?.authHashHash ?? null;
  }

  // Permanently deletes every row keyed by the user across all per-user tables
  // in one transaction. Each owning module purges its own tables, so account
  // deletion never reaches across module boundaries. `prices` and
  // `symbol_profiles` are global and intentionally untouched.
  async destroyUser(opts: { userId: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await purgeSyncData({ tx, userId: opts.userId });
      await purgeAuthData({ tx, userId: opts.userId });
    });
  }
}
