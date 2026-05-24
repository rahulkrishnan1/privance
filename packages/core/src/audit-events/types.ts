/**
 * Canonical audit event class registry.
 *
 * Every string here must match an eventClass value emitted by a server-side
 * logEvent() call site. The snapshot test in audit-events.test.ts locks the
 * array order, so any addition, removal, or rename is a compile error AND a
 * test failure, accidental drift is caught immediately.
 *
 * Auth events use underscores. Resource events use dot-notation (module.action).
 */
export type AuditEventClass =
  // Auth, signup
  | "signup_succeeded"
  | "signup_fail_username_taken"
  | "signup_blocked_allowlist"
  | "invite_minted"
  | "signup_fail_invite_required"
  | "signup_fail_invite_invalid"
  // Auth, login
  | "kdf_params_query"
  | "login_succeeded"
  | "login_fail_unknown_user"
  | "login_fail_bad_hash"
  // Auth, session
  | "logout"
  | "logout_all"
  // Auth, password
  | "password_changed"
  // Auth, recovery
  | "recovery_params_query"
  | "recovery_succeeded"
  | "recovery_fail_unknown_user"
  | "recovery_fail_bad_proof"
  // Accounts
  | "account.created"
  | "account.updated"
  | "account.deleted"
  // Holdings
  | "holding.created"
  | "holding.updated"
  | "holding.deleted"
  // Holding groups
  | "group.created"
  | "group.updated"
  | "group.deleted"
  // Prices
  | "prices.fetched"
  | "prices.manual_refresh_requested"
  // Net worth
  | "net_worth.snapshot_written";

/**
 * All known audit event classes in a stable order.
 *
 * The snapshot test locks this array. Any addition, removal, or rename will
 * fail the test immediately, intentional protection against silent drift.
 */
export const AUDIT_EVENT_CLASSES: readonly AuditEventClass[] = [
  "signup_succeeded",
  "signup_fail_username_taken",
  "signup_blocked_allowlist",
  "invite_minted",
  "signup_fail_invite_required",
  "signup_fail_invite_invalid",
  "kdf_params_query",
  "login_succeeded",
  "login_fail_unknown_user",
  "login_fail_bad_hash",
  "logout",
  "logout_all",
  "password_changed",
  "recovery_params_query",
  "recovery_succeeded",
  "recovery_fail_unknown_user",
  "recovery_fail_bad_proof",
  "account.created",
  "account.updated",
  "account.deleted",
  "holding.created",
  "holding.updated",
  "holding.deleted",
  "group.created",
  "group.updated",
  "group.deleted",
  "prices.fetched",
  "prices.manual_refresh_requested",
  "net_worth.snapshot_written",
] as const;
