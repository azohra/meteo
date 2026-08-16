import type { TemperatureSample } from "./lapse.js";
import { parcelAscent } from "./parcel.js";

export { DRY_ADIABATIC_LAPSE_C_PER_M } from "./parcel.js";

/**
 * The thermal index now rides `parcelAscent`, the platform's one parcel
 * implementation: dry adiabatic to the LCL, moist pseudo-adiabatic above
 * it, and — the physical change — compared in VIRTUAL temperature, so
 * the vapour the parcel carries up and the vapour the environment holds
 * both count toward density. The previous implementation compared plain
 * temperatures along a dry adiabat only; in a moist boundary layer that
 * understates parcel buoyancy by a few tenths of a degree and cannot see
 * the moist branch above cloud base at all. Two parcels that disagree is
 * the platform's plausible-but-wrong failure mode, so this module keeps
 * none of its own physics: it negates `buoyancyC` from the ascent.
 *
 * Dew points are additive-optional inputs; a caller that supplies none
 * gets a bone-dry column (vapour pressure below 1e-6 hPa), which
 * reproduces the old plain-temperature arithmetic to well under 0.001
 * degC.
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
