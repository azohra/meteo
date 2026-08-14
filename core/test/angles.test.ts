import { describe, expect, it } from "vitest";
import { degreesToRadians, normalizeDegrees, radiansToDegrees } from "../src/angles.js";

describe("degreesToRadians / radiansToDegrees", () => {
  it("agree with the half-turn", () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 12);
    expect(radiansToDegrees(Math.PI)).toBeCloseTo(180, 12);
  });

  it("round-trip an arbitrary angle", () => {
    expect(radiansToDegrees(degreesToRadians(123.456))).toBeCloseTo(123.456, 10);
  });
});

describe("normalizeDegrees", () => {
  it("wraps into [0, 360)", () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(720)).toBe(0);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(359.5)).toBe(359.5);
    expect(normalizeDegrees(-360)).toBe(0);
  });
});
