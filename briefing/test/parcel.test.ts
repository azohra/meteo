import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENTRAINMENT_PER_M,
  DRY_ADIABATIC_LAPSE_C_PER_M,
  parcelAscent,
} from "../src/derive/parcel.js";

/** A dew point that carries no vapour worth speaking of (e_s < 1e-6 hPa). */
const DRY = -120;

describe("parcelAscent", () => {
  it("keeps the pipeline's dry adiabatic constant", () => {
    expect(DRY_ADIABATIC_LAPSE_C_PER_M).toBe(0.0098);
  });

  it("reads zero buoyancy through a dry neutral layer", () => {
    // Environment laid exactly on the dry adiabat, no moisture anywhere:
    // the parcel and the environment are the same air.
    const ascent = parcelAscent({ temperatureC: 20, dewPointC: DRY, elevationM: 1000 }, [
      { heightM: 1500, temperatureC: 20 - 0.0098 * 500, dewPointC: DRY },
      { heightM: 2000, temperatureC: 20 - 0.0098 * 1000, dewPointC: DRY },
    ]);
    for (const sample of ascent.levels) {
      expect(sample.parcelTempC).toBeCloseTo(sample.envTempC, 9);
      expect(sample.buoyancyC).toBeCloseTo(0, 6);
    }
    expect(ascent.lclM).toBeNull();
  });

  it("finds the LCL where the conserved mixing ratio meets saturation", () => {
    // Hand-computed by bisection along the dry adiabat with the same
    // Magnus curve and ISA pressure: w0 = w(15C, 1013.25 hPa) = 0.010626;
    // w_s(25 - 0.0098 z, p(z)) = w0 at z = 1258.3 m. Bolton (1980, eq. 15)
    // places the same LCL at 1252.6 m — within its stated fit error.
    const ascent = parcelAscent({ temperatureC: 25, dewPointC: 15, elevationM: 0 }, [
      { heightM: 3000, temperatureC: -2, dewPointC: -20 },
    ]);
    expect(ascent.lclM).not.toBeNull();
    expect(ascent.lclM!).toBeCloseTo(1258.3, 0);
    expect(Math.abs(ascent.lclM! - 1252.6)).toBeLessThan(15);
  });

  it("rides the moist pseudo-adiabat above a saturated surface", () => {
    // Saturated from the ground: T = Td = 20C at sea level. Hand
    // integration of Gamma_m at 0.02 m steps gives T(1000 m) = 15.654,
    // Tv(1000 m) = 17.826 - far above the dry-adiabat 10.2.
    const ascent = parcelAscent({ temperatureC: 20, dewPointC: 20, elevationM: 0 }, [
      { heightM: 1000, temperatureC: 12, dewPointC: 10 },
    ]);
    expect(ascent.lclM).toBe(0);
    const sample = ascent.levels[0];
    expect(sample.parcelTempC).toBeCloseTo(15.654, 1);
    expect(sample.parcelTempC).toBeGreaterThan(20 - 0.0098 * 1000);
    expect(sample.parcelVirtualTempC).toBeCloseTo(17.826, 1);
    expect(sample.parcelVirtualTempC).toBeGreaterThan(sample.parcelTempC);
  });

  it("joins the dry leg to the moist leg without a seam", () => {
    // Surface 25C / dew point 15C at sea level, LCL 1258.3 m. Hand
    // integration (0.02 m steps): dry to the LCL, then moist:
    //   z:      500     1000    1500     2000    3000
    //   T_p:    20.100  15.200  11.525   9.106   4.022
    const levels = [500, 1000, 1500, 2000, 3000].map((heightM) => ({
      heightM,
      temperatureC: 22 - 0.0075 * heightM,
      dewPointC: 22 - 0.0075 * heightM - 15,
    }));
    const ascent = parcelAscent({ temperatureC: 25, dewPointC: 15, elevationM: 0 }, levels);
    const expected = [20.1, 15.2, 11.525, 9.106, 4.022];
    ascent.levels.forEach((sample, index) => {
      expect(sample.parcelTempC).toBeCloseTo(expected[index], 2);
      expect(sample.buoyancyC).toBeCloseTo(sample.parcelVirtualTempC - sample.envVirtualTempC, 12);
    });
    // Below the LCL the dry adiabat is exact.
    expect(ascent.levels[0].parcelTempC).toBeCloseTo(25 - 0.0098 * 500, 6);
    expect(ascent.levels[1].parcelTempC).toBeCloseTo(25 - 0.0098 * 1000, 6);
  });

  it("samples exactly the published levels, in published order", () => {
    const ascent = parcelAscent({ temperatureC: 25, dewPointC: 10, elevationM: 100 }, [
      { heightM: 2000, temperatureC: 8, dewPointC: -5 },
      { heightM: 500, temperatureC: 20, dewPointC: 8 },
      { heightM: 1200, temperatureC: 14, dewPointC: 2 },
    ]);
    expect(ascent.levels.map((sample) => sample.heightM)).toEqual([2000, 500, 1200]);
    expect(ascent.levels[1].parcelTempC).toBeCloseTo(25 - 0.0098 * 400, 6);
  });

  it("gives a level at or below the surface the unlifted surface parcel", () => {
    const ascent = parcelAscent({ temperatureC: 18, dewPointC: 6, elevationM: 1000 }, [
      { heightM: 800, temperatureC: 21, dewPointC: 8 },
      { heightM: 1000, temperatureC: 18, dewPointC: 6 },
    ]);
    expect(ascent.levels[0].parcelTempC).toBe(18);
    // At the surface itself the parcel is the environment: zero buoyancy.
    expect(ascent.levels[1].buoyancyC).toBeCloseTo(0, 9);
  });

  it("reports a null LCL when the column never saturates below its top", () => {
    // LCL would sit near 1258 m; the column stops at 800 m.
    const ascent = parcelAscent({ temperatureC: 25, dewPointC: 15, elevationM: 0 }, [
      { heightM: 800, temperatureC: 18, dewPointC: 8 },
    ]);
    expect(ascent.lclM).toBeNull();
  });

  it("clamps supersaturated surface data to saturation", () => {
    const ascent = parcelAscent({ temperatureC: 20, dewPointC: 22, elevationM: 500 }, [
      { heightM: 1500, temperatureC: 12, dewPointC: 11 },
    ]);
    expect(ascent.lclM).toBe(500);
  });

  it("ships an undiluted TRIAL default and lets entrainment dilute buoyancy", () => {
    expect(DEFAULT_ENTRAINMENT_PER_M).toBe(0);
    const surface = { temperatureC: 28, dewPointC: 12, elevationM: 0 };
    // A cold, dry environment: the undiluted parcel is strongly buoyant;
    // an entraining parcel mixes toward the environment and reads less so.
    const levels = [
      { heightM: 1000, temperatureC: 14, dewPointC: -6 },
      { heightM: 2500, temperatureC: 2, dewPointC: -18 },
    ];
    const undiluted = parcelAscent(surface, levels);
    const entraining = parcelAscent(surface, levels, { entrainmentPerM: 2e-4 });
    expect(parcelAscent(surface, levels, { entrainmentPerM: 0 }).levels).toEqual(undiluted.levels);
    for (let index = 0; index < levels.length; index += 1) {
      expect(entraining.levels[index].buoyancyC).toBeLessThan(undiluted.levels[index].buoyancyC);
      expect(entraining.levels[index].buoyancyC).toBeGreaterThan(0);
    }
  });

  it("returns no samples for a column without levels", () => {
    const ascent = parcelAscent({ temperatureC: 20, dewPointC: 5, elevationM: 300 }, []);
    expect(ascent.levels).toEqual([]);
    expect(ascent.lclM).toBeNull();
  });
});
