/**
 * Unit tests for payloadToSimInput.
 *
 * Covers: preset mapping (muBps/sigmaBps/stockWeight), custom field pass-through,
 * and cents-string -> Decimal conversion.
 */

import { Decimal, SCALE_CENTS } from "@privance/core";
import { PRESET_BALANCED } from "@privance/core/projection";
import { describe, expect, it } from "vitest";
import { payloadToSimInput } from "./sim-input";

function toCents(dollars: number): Decimal {
  return Decimal.fromMinorUnits(BigInt(Math.round(dollars * 100)), SCALE_CENTS);
}

const POT = toCents(500_000);

const BASE_PAYLOAD = {
  schemaVersion: 1 as const,
  currentAge: 35,
  planUntilAge: 65,
  swrBps: 400,
  seed: "test-seed",
};

describe("payloadToSimInput", () => {
  it("balanced preset maps to PRESET_BALANCED muBps/sigmaBps/stockWeight", () => {
    const input = payloadToSimInput(
      {
        ...BASE_PAYLOAD,
        preset: "balanced",
        monthlyContributionCents: "200000",
        annualSpendCents: "4000000",
      },
      POT,
    );
    expect(input.muBps).toBe(PRESET_BALANCED.muBps);
    expect(input.sigmaBps).toBe(PRESET_BALANCED.sigmaBps);
    expect(input.stockWeight).toBe(PRESET_BALANCED.stockWeight);
  });

  it("custom preset maps muBps/sigmaBps/stockWeightBps correctly", () => {
    const input = payloadToSimInput(
      {
        ...BASE_PAYLOAD,
        preset: "custom",
        muBps: 700,
        sigmaBps: 1400,
        stockWeightBps: 7500,
        monthlyContributionCents: "100000",
        annualSpendCents: "3000000",
      },
      POT,
    );
    expect(input.muBps).toBe(700);
    expect(input.sigmaBps).toBe(1400);
    // stockWeight = stockWeightBps / 10000
    expect(input.stockWeight).toBe(0.75);
  });

  it("cents strings convert to the correct Decimal values", () => {
    const input = payloadToSimInput(
      {
        ...BASE_PAYLOAD,
        preset: "balanced",
        monthlyContributionCents: "150000",
        annualSpendCents: "4800000",
      },
      POT,
    );
    // 150000 minor units = $1500.00
    expect(input.monthlyContributionCents.toMinorUnits()).toBe(150000n);
    // 4800000 minor units = $48000.00
    expect(input.annualSpendCents.toMinorUnits()).toBe(4800000n);
    // starting pot passed through unchanged
    expect(input.startingPotCents.toMinorUnits()).toBe(POT.toMinorUnits());
  });
});
