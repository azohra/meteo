import { describe, expect, it } from "vitest";
import { pressureTendency, seaLevelPressureHpa } from "../src/index.js";
import { BASE_MS, MINUTE_MS, iso } from "./fixtures.js";

describe("seaLevelPressureHpa", () => {
  it("reduces a known station pressure to sea level", () => {
    expect(seaLevelPressureHpa(947.7, 450, 20.2)).toBeCloseTo(998.44, 2);
  });

  it("is the identity at sea level", () => {
    expect(seaLevelPressureHpa(1013.25, 0, 7)).toBe(1013.25);
  });

  it("defaults a missing temperature to the ISA 15 °C", () => {
    expect(seaLevelPressureHpa(947.4, 450)).toBeCloseTo(999.06, 2);
    expect(seaLevelPressureHpa(947.4, 450, null)).toBe(seaLevelPressureHpa(947.4, 450));
  });

  it("reduces harder through cold air than warm", () => {
    expect(seaLevelPressureHpa(947.7, 450, -10)).toBeGreaterThan(
      seaLevelPressureHpa(947.7, 450, 30),
    );
  });
});

describe("pressureTendency", () => {
  const point = (minutesAgo: number, seaLevelPressure: number | null) => ({
    observedAt: iso(BASE_MS - minutesAgo * MINUTE_MS),
    seaLevelPressureHpa: seaLevelPressure,
  });

  it("reads rising and falling against the sample nearest three hours back", () => {
    const rising = [point(200, 1000), point(180, 1000.4), point(60, 1001.5), point(0, 1002.2)];
    expect(pressureTendency(rising)).toBe("rising");

    const falling = [point(200, 1004), point(180, 1003.8), point(60, 1002.5), point(0, 1002.1)];
    expect(pressureTendency(falling)).toBe("falling");
  });

  it("calls a sub-threshold drift steady", () => {
    const steady = [point(200, 1001), point(180, 1001.2), point(60, 1001.5), point(0, 1001.7)];
    expect(pressureTendency(steady)).toBe("steady");
  });

  it("skips null gaps rather than treating them as data", () => {
    const gappy = [point(190, 1000), point(120, null), point(60, null), point(0, 1002.3)];
    expect(pressureTendency(gappy)).toBe("rising");
  });

  it("returns null when the series cannot reach the window", () => {
    expect(pressureTendency([point(60, 1000), point(0, 1003)])).toBeNull();
    expect(pressureTendency([point(0, 1002)])).toBeNull();
    expect(pressureTendency([])).toBeNull();
    expect(pressureTendency([point(200, null), point(0, 1002)])).toBeNull();
  });

  it("honors a caller's window and threshold", () => {
    const points = [point(70, 1000), point(0, 1001)];
    expect(pressureTendency(points, { windowHours: 1, thresholdHpa: 0.5 })).toBe("rising");
    expect(pressureTendency(points, { windowHours: 1, thresholdHpa: 2 })).toBe("steady");
  });
});
