import { describe, expect, it } from "vitest";
import { dewPointDepression } from "../src/moisture.js";

describe("dewPointDepression", () => {
  it("matches the Python derivation on ordinary values", () => {
    expect(Math.abs(dewPointDepression(24, 45) - 12.662716080726646)).toBeLessThan(5e-10);
    expect(Math.abs(dewPointDepression(-10, 30) - 14.3257493281071)).toBeLessThan(5e-10);
    expect(Math.abs(dewPointDepression(15.5, 62.3) - 7.179121825283596)).toBeLessThan(5e-10);
  });

  it("matches the hand-checked dew points", () => {
    // Hand checks: 20 °C at 50 % RH dews at 9.26 °C; 5 °C at 80 % RH at 1.84 °C.
    expect(Math.abs(dewPointDepression(20.0, 50.0) - (20.0 - 9.26))).toBeLessThanOrEqual(0.01);
    expect(Math.abs(dewPointDepression(5.0, 80.0) - (5.0 - 1.84))).toBeLessThanOrEqual(0.01);
  });

  it("saturated air has zero depression", () => {
    expect(dewPointDepression(0, 100)).toBe(0.0);
  });

  it("clamps humidity to the physical range [1, 100]", () => {
    // Supersaturated input clamps to 100: the depression collapses to the
    // float noise of the round trip, exactly as at 100.
    expect(dewPointDepression(30, 120)).toBe(dewPointDepression(30, 100));
    expect(Math.abs(dewPointDepression(30, 120))).toBeLessThan(1e-10);
    // Near-zero humidity clamps to 1% instead of diverging.
    expect(dewPointDepression(20, 0.5)).toBe(dewPointDepression(20, 1));
    expect(Math.abs(dewPointDepression(20, 0.5) - 57.986592486309604)).toBeLessThan(5e-10);
  });
});
