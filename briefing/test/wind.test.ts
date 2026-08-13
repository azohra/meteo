import { describe, expect, it } from "vitest";
import {
  componentsToWind,
  msToKmh,
  normalizeDegrees,
  windToComponents,
} from "../src/derive/wind.js";

describe("windToComponents", () => {
  it("sends a north wind (from 0) blowing south", () => {
    const { uMps, vMps } = windToComponents(5, 0);
    expect(uMps).toBeCloseTo(0, 10);
    expect(vMps).toBeCloseTo(-5, 10);
  });

  it("sends a west wind (from 270) blowing east", () => {
    const { uMps, vMps } = windToComponents(5, 270);
    expect(uMps).toBeCloseTo(5, 10);
    expect(vMps).toBeCloseTo(0, 10);
  });
});

describe("componentsToWind", () => {
  it("round-trips speed and direction", () => {
    for (const [speed, direction] of [
      [7, 123],
      [1.47, 246],
      [12, 0],
      [3, 359],
    ] as const) {
      const { uMps, vMps } = windToComponents(speed, direction);
      const wind = componentsToWind(uMps, vMps);
      expect(wind.speedMps).toBeCloseTo(speed, 10);
      expect(wind.directionDeg).toBeCloseTo(direction, 10);
    }
  });

  it("reports calm air as speed 0, direction 0", () => {
    expect(componentsToWind(0, 0)).toEqual({ speedMps: 0, directionDeg: 0 });
  });
});

describe("normalizeDegrees", () => {
  it("wraps into [0, 360)", () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(720)).toBe(0);
    expect(normalizeDegrees(359.5)).toBe(359.5);
  });
});

describe("msToKmh", () => {
  it("converts m/s to km/h (moved here from scene in 0.3.0)", () => {
    expect(msToKmh(10)).toBeCloseTo(36, 12);
    expect(msToKmh(0)).toBe(0);
  });

  it("departed the scene surface in 0.4.0, as the deprecation promised", async () => {
    const scene = await import("../src/scene/index.js");
    expect("msToKmh" in scene).toBe(false);
  });
});
