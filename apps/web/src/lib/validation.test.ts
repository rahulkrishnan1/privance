import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  validatePassword,
  validateUsername,
} from "./validation";

describe("validateUsername", () => {
  it("rejects an empty username", () => {
    expect(validateUsername("")).toMatch(/required/);
    expect(validateUsername("   ")).toMatch(/required/);
  });

  it("rejects below the minimum length", () => {
    expect(validateUsername("a".repeat(USERNAME_MIN - 1))).toMatch(/at least/);
  });

  it("accepts the minimum length", () => {
    expect(validateUsername("a".repeat(USERNAME_MIN))).toBeUndefined();
  });

  it("accepts the maximum length", () => {
    expect(validateUsername("a".repeat(USERNAME_MAX))).toBeUndefined();
  });

  it("rejects above the maximum length", () => {
    expect(validateUsername("a".repeat(USERNAME_MAX + 1))).toMatch(/or fewer/);
  });

  it("accepts the allowed charset", () => {
    expect(validateUsername("alice.bob_99-x")).toBeUndefined();
  });

  it("rejects characters outside the charset", () => {
    expect(validateUsername("alice!")).toMatch(/may only contain/);
    expect(validateUsername("alice bob")).toMatch(/may only contain/);
  });

  it("normalizes case before validating", () => {
    // Uppercase is lowercased, so a valid lowercased form passes.
    expect(validateUsername("ALICE")).toBeUndefined();
  });
});

describe("validatePassword", () => {
  it("rejects below the minimum length", () => {
    expect(validatePassword("a".repeat(PASSWORD_MIN - 1))).toMatch(/at least/);
  });

  it("accepts the minimum length", () => {
    expect(validatePassword("a".repeat(PASSWORD_MIN))).toBeUndefined();
  });

  it("accepts the maximum length", () => {
    expect(validatePassword("a".repeat(PASSWORD_MAX))).toBeUndefined();
  });

  it("rejects above the maximum length", () => {
    expect(validatePassword("a".repeat(PASSWORD_MAX + 1))).toMatch(/or fewer/);
  });

  it("rejects an empty password", () => {
    expect(validatePassword("")).toMatch(/at least/);
  });
});
