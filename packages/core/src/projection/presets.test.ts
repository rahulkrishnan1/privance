import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Preset } from "./presets.js";
import {
  deriveAllocationParams,
  getPreset,
  PRESET_AGGRESSIVE,
  PRESET_BALANCED,
  PRESET_CONSERVATIVE,
  PRESETS,
} from "./presets.js";

describe("preset constants match dataset-derived values (consistency gate)", () => {
  const cases: { preset: Preset; label: string }[] = [
    { preset: PRESET_CONSERVATIVE, label: "conservative 30/70" },
    { preset: PRESET_BALANCED, label: "balanced 60/40" },
    { preset: PRESET_AGGRESSIVE, label: "aggressive 90/10" },
  ];

  for (const { preset, label } of cases) {
    it(`${label} muBps and sigmaBps and geoMeanBps match deriveAllocationParams`, () => {
      const computed = deriveAllocationParams(preset.stockWeight);
      expect(preset.muBps).toBe(computed.muBps);
      expect(preset.sigmaBps).toBe(computed.sigmaBps);
      expect(preset.geoMeanBps).toBe(computed.geoMeanBps);
    });
  }
});

describe("deriveAllocationParams", () => {
  it("clamps stock weight to [0, 1]", () => {
    expect(deriveAllocationParams(-0.5)).toEqual(deriveAllocationParams(0));
    expect(deriveAllocationParams(1.5)).toEqual(deriveAllocationParams(1));
  });

  it("mu rises with stock weight (stocks out-returned bonds over the dataset)", () => {
    const weights = [0, 0.25, 0.5, 0.75, 1];
    const mus = weights.map((w) => deriveAllocationParams(w).muBps);
    for (let i = 1; i < mus.length; i++) {
      expect(mus[i]).toBeGreaterThan(mus[i - 1]);
    }
  });

  it("mu exceeds geometric mean for any positive-volatility mix (Jensen)", () => {
    for (const w of [0, 0.3, 0.6, 0.9, 1]) {
      const { muBps, geoMeanBps, sigmaBps } = deriveAllocationParams(w);
      expect(sigmaBps).toBeGreaterThan(0);
      expect(muBps).toBeGreaterThan(geoMeanBps);
    }
  });

  it("returns finite integer bps for any weight across the continuous [0, 1] range", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (w) => {
        const { muBps, sigmaBps, geoMeanBps } = deriveAllocationParams(w);
        for (const v of [muBps, sigmaBps, geoMeanBps]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(Number.isFinite(v)).toBe(true);
        }
        // The slider can only ever raise risk by adding stocks.
        expect(sigmaBps).toBeGreaterThan(0);
      }),
    );
  });
});

describe("arithmetic-geometric gap approximately equals sigma^2/2", () => {
  for (const preset of PRESETS) {
    it(`${preset.id}: mu - geoMean ~ sigma^2 / 2 (within 10% relative)`, () => {
      const mu = preset.muBps / 10000;
      const geo = preset.geoMeanBps / 10000;
      const sigma = preset.sigmaBps / 10000;
      const actualGap = mu - geo;
      const theoreticalGap = (sigma * sigma) / 2;
      // Jensen's inequality approximation is exact for lognormal; real data
      // deviates slightly. Allow 10% relative error.
      const relError = Math.abs(actualGap - theoreticalGap) / theoreticalGap;
      expect(relError).toBeLessThan(0.1);
    });
  }
});

describe("preset ordering", () => {
  it("arithmetic mean > geometric mean for all presets (Jensen's inequality)", () => {
    for (const preset of PRESETS) {
      expect(preset.muBps).toBeGreaterThan(preset.geoMeanBps);
    }
  });

  it("returns and volatility increase from conservative to aggressive", () => {
    expect(PRESET_CONSERVATIVE.muBps).toBeLessThan(PRESET_BALANCED.muBps);
    expect(PRESET_BALANCED.muBps).toBeLessThan(PRESET_AGGRESSIVE.muBps);
    expect(PRESET_CONSERVATIVE.sigmaBps).toBeLessThan(PRESET_BALANCED.sigmaBps);
    expect(PRESET_BALANCED.sigmaBps).toBeLessThan(PRESET_AGGRESSIVE.sigmaBps);
  });

  it("stock weights are ordered 0.30 < 0.60 < 0.90", () => {
    expect(PRESET_CONSERVATIVE.stockWeight).toBe(0.3);
    expect(PRESET_BALANCED.stockWeight).toBe(0.6);
    expect(PRESET_AGGRESSIVE.stockWeight).toBe(0.9);
  });
});

describe("getPreset", () => {
  it("returns the correct preset for each id", () => {
    expect(getPreset("conservative")).toBe(PRESET_CONSERVATIVE);
    expect(getPreset("balanced")).toBe(PRESET_BALANCED);
    expect(getPreset("aggressive")).toBe(PRESET_AGGRESSIVE);
  });
});
