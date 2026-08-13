import { describe, expect, it } from "vitest";
import { dewPointC, dewPointDepressionC, relativeHumidityPercent } from "../src/derive/moisture.js";

describe("relativeHumidityPercent", () => {
  it("matches the published Magnus value for 20C / dew point 10C", () => {
    expect(relativeHumidityPercent(20, 10)).toBeCloseTo(52.54, 1);
  });

  it("is 100 when saturated", () => {
    expect(relativeHumidityPercent(15, 15)).toBeCloseTo(100, 10);
  });

  it("clamps supersaturated data noise to 100", () => {
    expect(relativeHumidityPercent(15, 15.3)).toBe(100);
  });

  it("falls as the dew point drops", () => {
    expect(relativeHumidityPercent(20, 0)).toBeLessThan(relativeHumidityPercent(20, 10));
  });
});

describe("dewPointC", () => {
  it("round-trips with relativeHumidityPercent", () => {
    for (const [temperature, dewPoint] of [
      [30, 5],
      [20, 10],
      [0, -12],
      [-15, -20],
    ] as const) {
      const rh = relativeHumidityPercent(temperature, dewPoint);
      expect(dewPointC(temperature, rh)).toBeCloseTo(dewPoint, 6);
    }
  });

  it("returns the temperature at 100% humidity", () => {
    expect(dewPointC(22.5, 100)).toBeCloseTo(22.5, 10);
  });

  it("clamps RH above 100 to the temperature", () => {
    expect(dewPointC(22.5, 130)).toBeCloseTo(22.5, 10);
  });

  it("clamps zero, negative, and sub-1% humidity to the RH = 1 floor", () => {
    const atFloor = dewPointC(20, 1);
    expect(dewPointC(20, 0)).toBe(atFloor);
    expect(dewPointC(20, -5)).toBe(atFloor);
    expect(dewPointC(20, 0.5)).toBe(atFloor);
    expect(Number.isFinite(atFloor)).toBe(true);
  });
});

describe("cross-language clamp pins (Python authority)", () => {
  const depression = (temperatureC: number, rhPercent: number) =>
    dewPointDepressionC(temperatureC, dewPointC(temperatureC, rhPercent));

  it("matches Python at and below the RH = 1 floor", () => {
    expect(depression(20, 0)).toBeCloseTo(57.986592486309604, 9);
    expect(depression(20, 0.5)).toBeCloseTo(57.986592486309604, 9);
    expect(depression(20, 1)).toBeCloseTo(57.986592486309604, 9);
  });

  it("matches Python in the interior", () => {
    expect(depression(20, 50)).toBeCloseTo(10.738893369465764, 9);
  });
});

describe("dewPointDepressionC", () => {
  it("is temperature minus dew point", () => {
    expect(dewPointDepressionC(28.28, 4.72)).toBeCloseTo(23.56, 10);
    expect(dewPointDepressionC(5, 5)).toBe(0);
  });
});
