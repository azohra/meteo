import { describe, expect, it } from "vitest";
import {
  DRY_ADIABATIC_LAPSE_C_PER_M,
  thermalIndexC,
  thermalIndexProfile,
} from "../src/derive/thermal-index.js";

describe("thermalIndexC", () => {
  it("uses the pipeline's dry adiabatic constant", () => {
    expect(DRY_ADIABATIC_LAPSE_C_PER_M).toBe(0.0098);
  });

  it("reduces to the plain lifted-parcel comparison when no dew points are given", () => {
    // Without dew points the column is treated as bone dry, so the
    // virtual-temperature parcel reproduces the old plain-temperature
    // arithmetic to well under 0.001 degC.
    expect(
      thermalIndexC({
        surfaceTemperatureC: 30,
        surfaceElevationM: 1000,
        level: { heightM: 2000, temperatureC: 21.5 },
      }),
    ).toBeCloseTo(1.3, 6);
  });

  it("is negative while the parcel stays warmer than the environment", () => {
    expect(
      thermalIndexC({
        surfaceTemperatureC: 30,
        surfaceElevationM: 1000,
        level: { heightM: 2000, temperatureC: 15 },
      }),
    ).toBeCloseTo(-5.2, 6);
  });

  it("is zero at the surface itself", () => {
    expect(
      thermalIndexC({
        surfaceTemperatureC: 28.28,
        surfaceDewPointC: 12.4,
        surfaceElevationM: 1072.5,
        level: { heightM: 1072.5, temperatureC: 28.28, dewPointC: 12.4 },
      }),
    ).toBeCloseTo(0, 9);
  });

  it("counts surface moisture toward buoyancy: a moister parcel reads a lower TI", () => {
    const level = { heightM: 2000, temperatureC: 16, dewPointC: -4 };
    const dry = thermalIndexC({
      surfaceTemperatureC: 26,
      surfaceDewPointC: 2,
      surfaceElevationM: 1000,
      level,
    });
    const moist = thermalIndexC({
      surfaceTemperatureC: 26,
      surfaceDewPointC: 12,
      surfaceElevationM: 1000,
      level,
    });
    expect(moist).toBeLessThan(dry);
  });

  it("rides the moist pseudo-adiabat above the LCL", () => {
    // Surface 25C / dew point 15C at sea level saturates at 1258 m. At
    // 2000 m the old dry-only parcel read 25 - 19.6 = 5.4C against an 8C
    // environment (TI +2.6, stable); the moist branch keeps the saturated
    // parcel near 9.1C (10.7C virtual), so the same level reads buoyant.
    const ti = thermalIndexC({
      surfaceTemperatureC: 25,
      surfaceDewPointC: 15,
      surfaceElevationM: 0,
      level: { heightM: 2000, temperatureC: 8, dewPointC: -10 },
    });
    expect(ti).toBeLessThan(0);
    expect(ti).toBeCloseTo(-2.28, 1);
  });

  it("stays within 0.15 degC of the old dry formula on a negligible-moisture sounding", () => {
    // Dew points 40 below temperature everywhere - vapour is present but
    // meteorologically negligible. Observed deltas are -0.03 to -0.12
    // degC (the parcel's surface vapour outweighs the drier air aloft);
    // the documented regression bound is 0.15 degC.
    const surfaceTemperatureC = 20;
    const surfaceElevationM = 1000;
    for (const level of [
      { heightM: 1500, temperatureC: 17 },
      { heightM: 2500, temperatureC: 10 },
      { heightM: 4000, temperatureC: -2 },
    ]) {
      const oldTi =
        level.temperatureC -
        (surfaceTemperatureC - DRY_ADIABATIC_LAPSE_C_PER_M * (level.heightM - surfaceElevationM));
      const newTi = thermalIndexC({
        surfaceTemperatureC,
        surfaceDewPointC: surfaceTemperatureC - 40,
        surfaceElevationM,
        level: { ...level, dewPointC: level.temperatureC - 40 },
      });
      expect(Math.abs(newTi - oldTi)).toBeLessThan(0.15);
    }
  });
});

describe("thermalIndexProfile", () => {
  it("maps every level in published order", () => {
    const profile = thermalIndexProfile(30, 1000, [
      { heightM: 1500, temperatureC: 24 },
      { heightM: 2000, temperatureC: 21.5 },
    ]);
    expect(profile).toHaveLength(2);
    expect(profile[0].heightM).toBe(1500);
    expect(profile[0].thermalIndexC).toBeCloseTo(24 - (30 - 0.0098 * 500), 6);
    expect(profile[1].thermalIndexC).toBeCloseTo(1.3, 6);
  });

  it("agrees with per-level thermalIndexC on a moist column", () => {
    const levels = [
      { heightM: 1500, temperatureC: 18, dewPointC: 8 },
      { heightM: 2500, temperatureC: 10, dewPointC: -2 },
    ];
    const profile = thermalIndexProfile(24, 1000, levels, 14);
    levels.forEach((level, index) => {
      expect(profile[index].thermalIndexC).toBeCloseTo(
        thermalIndexC({
          surfaceTemperatureC: 24,
          surfaceDewPointC: 14,
          surfaceElevationM: 1000,
          level,
        }),
        9,
      );
    });
  });

  it("returns an empty profile for a model without levels", () => {
    expect(thermalIndexProfile(30, 1000, [])).toEqual([]);
  });
});
