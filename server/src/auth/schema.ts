import { customType, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable("users", {
  userId: uuid("user_id").primaryKey().defaultRandom(),
  username: text("username").unique().notNull(),
  authHashHash: bytea("auth_hash_hash").notNull(),
  kdfParams: jsonb("kdf_params").notNull(),
  recoveryBlob: bytea("recovery_blob").notNull(),
  recoverySalt: bytea("recovery_salt").notNull(),
  recoveryParams: jsonb("recovery_params").notNull(),
  wrappedDek: bytea("wrapped_dek").notNull(),
  wrappedDekIv: bytea("wrapped_dek_iv").notNull(),
  wrappedDekRecovery: bytea("wrapped_dek_recovery").notNull(),
  wrappedDekRecoveryIv: bytea("wrapped_dek_recovery_iv").notNull(),
  kdfSalt: bytea("kdf_salt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  sessionId: uuid("session_id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  tokenHash: bytea("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    eventId: uuid("event_id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    eventClass: text("event_class").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_user_time_idx").on(table.userId, table.occurredAt)],
);
