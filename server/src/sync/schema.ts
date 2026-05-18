import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const syncObjects = pgTable(
  "sync_objects",
  {
    userId: text("user_id").notNull(),
    objectId: text("object_id").notNull(),
    kind: text("kind").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    nonce: bytea("nonce").notNull(),
    version: bigint("version", { mode: "bigint" }).notNull(),
    serverSeq: bigserial("server_seq", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    tombstone: boolean("tombstone").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.objectId] }),
    index("sync_objects_user_seq_idx").on(table.userId, table.serverSeq),
  ],
);
