import { describe, expect, it } from "vitest";
import { componentsToWind, meanDirectionDeg, windToComponents } from "../src/wind.js";

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
  it("round-trips speed and from-direction", () => {
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

describe("meanDirectionDeg", () => {
  it("is null on empty input", () => {
    expect(meanDirectionDeg([])).toBeNull();
  });

  it("returns the lone direction", () => {
    expect(meanDirectionDeg([90])).toBeCloseTo(90, 10);
  });

  it("averages across the north wrap — the reason a circular mean exists", () => {
    expect(meanDirectionDeg([350, 10])).toBeCloseTo(0, 10);
  });

  it("bisects two equal-weight directions", () => {
    expect(meanDirectionDeg([0, 90])).toBeCloseTo(45, 10);
  });
});
