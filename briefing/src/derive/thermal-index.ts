import type { TemperatureSample } from "./lapse.js";
import { parcelAscent } from "./parcel.js";

export { DRY_ADIABATIC_LAPSE_C_PER_M } from "./parcel.js";

/**
 * Thermal index over `parcelAscent`, the platform's single parcel
 * implementation (dry adiabatic to the LCL, moist pseudo-adiabatic above,
 * compared in virtual temperature). This module keeps no physics of its
 * own — it negates `buoyancyC` from the ascent — so two parcel
 * implementations can never disagree. Dew points are optional; with none
 * supplied the column is dry and TI reduces to plain-temperature
 * arithmetic to under 0.001 degC.
 */

/** A dew point cold enough that Magnus vapour pressure is < 1e-6 hPa — the "no moisture information" stand-in the optional dew-point inputs fall back to. */
const DRY_DEW_POINT_C = -120;

/**
 * Thermal index (TI) at one level: the environment minus the lifted
 * surface parcel, both in virtual temperature,
 *
 *   TI = Tv_level − Tv_parcel(z_level)
 *
 * with the parcel from `parcelAscent` (dry adiabatic to the LCL, moist
 * pseudo-adiabatic above). RASP sign convention, unchanged: negative TI
 * means the parcel is still buoyant at that height (thermals reach it);
 * TI crossing zero is where thermals stop.
 */
export function thermalIndexC(args: {
  surfaceTemperatureC: number;
  surfaceElevationM: number;
  /** 2 m dew point; omitted, the surface air is treated as fully dry. */
  surfaceDewPointC?: number;
  level: TemperatureSample & { dewPointC?: number };
}): number {
  const ascent = parcelAscent(
    {
      temperatureC: args.surfaceTemperatureC,
      dewPointC: args.surfaceDewPointC ?? DRY_DEW_POINT_C,
      elevationM: args.surfaceElevationM,
    },
    [
      {
        heightM: args.level.heightM,
        temperatureC: args.level.temperatureC,
        dewPointC: args.level.dewPointC ?? DRY_DEW_POINT_C,
      },
    ],
  );
  return -ascent.levels[0].buoyancyC;
}

/**
 * TI per level for a whole profile hour, in the levels' published order —
 * one ascent for the column, so the moist branch above the LCL carries
 * through every level it crosses.
 */
export function thermalIndexProfile(
  surfaceTemperatureC: number,
  surfaceElevationM: number,
  levels: readonly (TemperatureSample & { dewPointC?: number })[],
  surfaceDewPointC?: number,
): Array<{ heightM: number; thermalIndexC: number }> {
  const ascent = parcelAscent(
    {
      temperatureC: surfaceTemperatureC,
      dewPointC: surfaceDewPointC ?? DRY_DEW_POINT_C,
      elevationM: surfaceElevationM,
    },
    levels.map((level) => ({
      heightM: level.heightM,
      temperatureC: level.temperatureC,
      dewPointC: level.dewPointC ?? DRY_DEW_POINT_C,
    })),
  );
  return ascent.levels.map((sample) => ({
    heightM: sample.heightM,
    thermalIndexC: -sample.buoyancyC,
  }));
}
