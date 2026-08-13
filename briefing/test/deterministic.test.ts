import { describe, expect, it } from "vitest";
import {
  isDeterministicProfile,
  parseSiteForecast,
  type DeterministicSiteForecast,
  type SiteForecast,
} from "../src/contract.js";
import { deterministicProfile, ensembleProfile } from "./fixtures.js";

describe("isDeterministicProfile", () => {
  it("accepts a deterministic document", () => {
    expect(isDeterministicProfile(deterministicProfile())).toBe(true);
  });

  it("rejects an ensemble document — run.members is the declaration", () => {
    expect(isDeterministicProfile(ensembleProfile())).toBe(false);
  });

  it("answers from the declaration alone, never the value shapes", () => {
    const declared = deterministicProfile();
    (declared.run as { members?: number }).members = 21;
    expect(isDeterministicProfile(declared)).toBe(false);
  });

  it("narrows the type so p50() becomes unnecessary — the one-check escape", () => {
    const parsed = parseSiteForecast(deterministicProfile());
    expect(parsed).not.toBeNull();
    const profile: SiteForecast = parsed!;
    expect(isDeterministicProfile(profile)).toBe(true);
    if (isDeterministicProfile(profile)) {
      const wStar: number = profile.hours[0].derived.thermalVelocityMps;
      const blTop: number | null = profile.hours[0].derived.boundaryLayerTopM;
      const temperature: number = profile.hours[0].surface.temperatureC;
      const gust: number | undefined = profile.hours[0].surface.windGustMps;
      const levelHeight: number = profile.hours[0].levels[0].heightM;
      const members: undefined = profile.run.members;
      expect(wStar).toBeCloseTo(1.63);
      expect(blTop).toBeCloseTo(3223.1);
      expect(temperature).toBeCloseTo(28.28);
      expect(gust).toBeUndefined();
      expect(levelHeight).toBeCloseTo(1252.4);
      expect(members).toBeUndefined();
      const widened: SiteForecast = profile satisfies DeterministicSiteForecast;
      expect(widened.model).toBe("hrdps-continental");
    }
  });
});
