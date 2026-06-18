import { describe, expect, test } from "vitest";
import { spendFormSchema } from "./types";

const VALID = {
  name: "Rent",
  amount: "1450.00",
  intervalCount: "1",
  intervalUnit: "month" as const,
  category: "housing" as const,
  group: "essentials" as const,
  nextRenewalAt: "2026-07-01",
  status: "active" as const,
};

describe("spendFormSchema", () => {
  test("accepts a valid item for every interval unit", () => {
    for (const intervalUnit of ["day", "week", "month", "year"] as const) {
      expect(spendFormSchema.safeParse({ ...VALID, intervalUnit }).success).toBe(true);
    }
  });

  test("accepts a multi-unit interval (every 2 years)", () => {
    const r = spendFormSchema.safeParse({ ...VALID, intervalCount: "2", intervalUnit: "year" });
    expect(r.success).toBe(true);
  });

  test("defaults status to active when omitted", () => {
    const { status, ...withoutStatus } = VALID;
    const r = spendFormSchema.safeParse(withoutStatus);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("active");
  });

  describe("amount", () => {
    test("rejects an empty amount", () => {
      const r = spendFormSchema.safeParse({ ...VALID, amount: "" });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe("Amount is required");
    });

    test("rejects a non-numeric amount", () => {
      const r = spendFormSchema.safeParse({ ...VALID, amount: "abc" });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe("Enter a valid amount (e.g. 15.49)");
    });

    test("rejects more than two decimal places", () => {
      expect(spendFormSchema.safeParse({ ...VALID, amount: "1.999" }).success).toBe(false);
    });

    test("rejects zero (passes the shape regex but is not positive)", () => {
      for (const amount of ["0", "0.00"]) {
        const r = spendFormSchema.safeParse({ ...VALID, amount });
        expect(r.success).toBe(false);
        if (!r.success) {
          expect(r.error.issues[0]?.message).toBe("Amount must be greater than zero");
        }
      }
    });

    test("accepts whole dollars and one or two decimals", () => {
      for (const amount of ["15", "15.4", "15.49"]) {
        expect(spendFormSchema.safeParse({ ...VALID, amount }).success).toBe(true);
      }
    });
  });

  describe("interval", () => {
    test("rejects a count below 1", () => {
      expect(spendFormSchema.safeParse({ ...VALID, intervalCount: "0" }).success).toBe(false);
    });

    test("rejects a non-integer count", () => {
      expect(spendFormSchema.safeParse({ ...VALID, intervalCount: "1.5" }).success).toBe(false);
    });

    test("rejects an empty count", () => {
      expect(spendFormSchema.safeParse({ ...VALID, intervalCount: "" }).success).toBe(false);
    });

    test("rejects a count above 99", () => {
      expect(spendFormSchema.safeParse({ ...VALID, intervalCount: "100" }).success).toBe(false);
    });

    test("rejects an unselected cadence (empty unit)", () => {
      expect(spendFormSchema.safeParse({ ...VALID, intervalUnit: "" }).success).toBe(false);
    });

    test("rejects an unknown unit", () => {
      expect(spendFormSchema.safeParse({ ...VALID, intervalUnit: "fortnight" }).success).toBe(
        false,
      );
    });
  });

  describe("nextRenewalAt", () => {
    test("is optional and accepts an empty string", () => {
      const { nextRenewalAt, ...withoutDate } = VALID;
      expect(spendFormSchema.safeParse(withoutDate).success).toBe(true);
      expect(spendFormSchema.safeParse({ ...VALID, nextRenewalAt: "" }).success).toBe(true);
    });

    test("rejects a malformed date", () => {
      expect(spendFormSchema.safeParse({ ...VALID, nextRenewalAt: "07/01/2026" }).success).toBe(
        false,
      );
    });
  });

  describe("name", () => {
    test("rejects an empty name", () => {
      expect(spendFormSchema.safeParse({ ...VALID, name: "" }).success).toBe(false);
    });

    test("rejects a name longer than 64 characters", () => {
      expect(spendFormSchema.safeParse({ ...VALID, name: "x".repeat(65) }).success).toBe(false);
      expect(spendFormSchema.safeParse({ ...VALID, name: "x".repeat(64) }).success).toBe(true);
    });
  });

  test("rejects an unknown category or group", () => {
    expect(spendFormSchema.safeParse({ ...VALID, category: "yacht" }).success).toBe(false);
    expect(spendFormSchema.safeParse({ ...VALID, group: "luxuries" }).success).toBe(false);
  });
});
