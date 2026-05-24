import { describe, expect, it } from "vitest";
import type { AuditEventClass } from "./types.js";
import { AUDIT_EVENT_CLASSES } from "./types.js";

/**
 * Snapshot test, locks the full audit event class list.
 *
 * If you add a new event class, update AUDIT_EVENT_CLASSES in types.ts
 * AND update the snapshot below. This ensures every event class is
 * intentionally registered and renames are immediately caught.
 */
describe("AUDIT_EVENT_CLASSES", () => {
  it("snapshot matches known event class list", () => {
    // Updating this array requires a deliberate, reviewed change.
    // Each string here must match an actual logEvent() call site in the server.
    const expected: readonly AuditEventClass[] = [
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
    ];

    expect(AUDIT_EVENT_CLASSES).toStrictEqual(expected);
  });

  it("contains exactly 29 event classes", () => {
    expect(AUDIT_EVENT_CLASSES).toHaveLength(29);
  });

  it("has no duplicate entries", () => {
    const unique = new Set<string>(AUDIT_EVENT_CLASSES);
    expect(unique.size).toBe(AUDIT_EVENT_CLASSES.length);
  });

  it("all entries are non-empty strings", () => {
    for (const cls of AUDIT_EVENT_CLASSES) {
      expect(typeof cls).toBe("string");
      expect(cls.length).toBeGreaterThan(0);
    }
  });
});
