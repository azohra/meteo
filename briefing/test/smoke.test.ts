import { describe, expect, it } from "vitest";

import type { SmokeDocument, SiteForecast } from "../src/contract.js";
import {
  cosSolarZenith,
  isSmokeAwareProfile,
  SMOKE_TRANSMITTANCE_K_MIDDAY,
  smokeAdjustedThermalVelocityMps,
  smokeAotFromColumn,
  smokeHoursByValidAt,
  smokeTransmittance,
} from "../src/derive/smoke.js";

describe("smokeAotFromColumn", () => {
  it("converts a plume column through the cited extinction efficiency", () => {
    expect(smokeAotFromColumn(200)).toBeCloseTo(0.94, 10);
  });

  it("treats a clean or noisy-negative column as no smoke", () => {
    expect(smokeAotFromColumn(0)).toBe(0);
    expect(smokeAotFromColumn(-0.1)).toBe(0);
  });
});

describe("smokeTransmittance", () => {
  it("is 1 for clear air", () => {
    expect(smokeTransmittance(0)).toBe(1);
  });

  it("applies the midday effective constant without a zenith", () => {
    expect(smokeTransmittance(1)).toBeCloseTo(Math.exp(-SMOKE_TRANSMITTANCE_K_MIDDAY), 10);
  });

  it("lengthens the slant path with the zenith-aware constant", () => {
    expect(smokeTransmittance(1, 0.5)).toBeCloseTo(Math.exp(-0.26), 10);
    expect(smokeTransmittance(1, 0.5)).toBeLessThan(smokeTransmittance(1, 0.95));
  });

  it("caps the path near the horizon and is 1 with the sun down", () => {
    expect(smokeTransmittance(1, 0.01)).toBeCloseTo(Math.exp(-0.13 / 0.15), 10);
    expect(smokeTransmittance(1, 0)).toBe(1);
    expect(smokeTransmittance(1, -0.4)).toBe(1);
  });

  it("matches the observed severe-smoke range: gentle, not exp(−τ)", () => {
    const f = smokeTransmittance(smokeAotFromColumn(200));
    expect(f).toBeGreaterThan(0.85);
    expect(f).toBeLessThan(0.87);
  });
});

describe("smokeAdjustedThermalVelocityMps", () => {
  it("derates by the cube root of the transmittance", () => {
    expect(smokeAdjustedThermalVelocityMps(2, 0.729)).toBeCloseTo(1.8, 10);
  });

  it("keeps no-thermals days at zero and clamps a wild factor", () => {
    expect(smokeAdjustedThermalVelocityMps(0, 0.5)).toBe(0);
    expect(smokeAdjustedThermalVelocityMps(-1, 0.5)).toBe(0);
    expect(smokeAdjustedThermalVelocityMps(2, 1.7)).toBe(2);
    expect(smokeAdjustedThermalVelocityMps(2, -0.2)).toBe(0);
  });

  it("is a gentle correction even in severe smoke — the honest headline", () => {
    const adjusted = smokeAdjustedThermalVelocityMps(2, smokeTransmittance(2));
    expect(adjusted / 2).toBeGreaterThan(0.89);
    expect(adjusted / 2).toBeLessThan(0.91);
  });
});

describe("isSmokeAwareProfile", () => {
  const base = { semantics: { gust: "instant" } } as SiteForecast;

  it("recognizes the radiativelyCoupled declaration and nothing else", () => {
    expect(
      isSmokeAwareProfile({ semantics: { smoke: "radiativelyCoupled" } } as SiteForecast),
    ).toBe(true);
    expect(isSmokeAwareProfile({ semantics: { smoke: "passive" } } as SiteForecast)).toBe(false);
    expect(isSmokeAwareProfile(base)).toBe(false);
    expect(isSmokeAwareProfile({} as SiteForecast)).toBe(false);
  });
});

describe("smokeHoursByValidAt", () => {
  it("keys the smoke series for a validAt join", () => {
    const smoke = {
      hours: [
        { validAt: "2026-08-10T01:00:00Z", pm25Ugm3: 37.5 },
        { validAt: "2026-08-10T02:00:00Z", pm25Ugm3: 40.1 },
      ],
    } as SmokeDocument;
    const byValidAt = smokeHoursByValidAt(smoke);
    expect(byValidAt.get("2026-08-10T02:00:00Z")?.pm25Ugm3).toBe(40.1);
    expect(byValidAt.has("2026-08-10T03:00:00Z")).toBe(false);
  });
});

describe("cosSolarZenith", () => {
  it("puts the summer-solstice midday sun high over southwest BC", () => {
    const cos = cosSolarZenith("2026-06-21T20:12:00Z", 49.25, -123.1);
    expect(cos).toBeGreaterThan(0.88);
    expect(cos).toBeLessThan(0.92);
  });

  it("is negative at night", () => {
    expect(cosSolarZenith("2026-06-21T08:12:00Z", 49.25, -123.1)).toBeLessThan(0);
  });
});
