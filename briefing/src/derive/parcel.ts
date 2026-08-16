import { mixingRatioKgKg, saturationMixingRatioKgKg, virtualTemperatureC } from "./moisture.js";

/**
 * Dry adiabatic lapse in degC per metre — the same constant the pipeline
 * uses to lift the surface parcel for boundary-layer top.
 */
export const DRY_ADIABATIC_LAPSE_C_PER_M = 0.0098;

/** Standard gravity, m/s² (ISO 2533:1975). */
const GRAVITY_MPS2 = 9.80665;

/** Specific gas constant of dry air, J/(kg·K) (Wallace & Hobbs 2006, sec. 3.1). */
const RD_J_PER_KG_K = 287.04;

/** Latent heat of vaporization near 0 degC, J/kg — held constant over the flyable band (Wallace & Hobbs 2006, table, sec. 3.5). */
const LV_J_PER_KG = 2.501e6;

/** Ratio of dry-air to water-vapour gas constants, Rd/Rv ≈ 0.622 (Wallace & Hobbs 2006, sec. 3.5.1). */
const RD_OVER_RV = 0.622;

/**
 * Dry-air specific heat, J/(kg·K), derived as g / Γd from the pipeline's
 * dry lapse constant so the moist lapse converges exactly onto the dry
 * leg as saturation mixing ratio goes to zero — one dry adiabat, not two.
 */
const CPD_J_PER_KG_K = GRAVITY_MPS2 / DRY_ADIABATIC_LAPSE_C_PER_M;

/**
 * TRIAL default for `entrainmentPerM`: 0, an undiluted pseudo-adiabatic
 * ascent. Caller-movable; bulk fractional entrainment for boundary-layer
 * thermals is commonly taken near 2e-4 per metre (Stull 1988, ch. 13).
 */
export const DEFAULT_ENTRAINMENT_PER_M = 0;

/** Integration step for the ascent, metres; published levels are always landed on exactly. */
const ASCENT_STEP_M = 10;

export interface ParcelLevelSample {
  heightM: number; // MSL
  envTempC: number;
  envVirtualTempC: number;
  parcelTempC: number;
  parcelVirtualTempC: number;
  /** parcelVirtualTempC − envVirtualTempC: positive means the parcel is buoyant at this level. */
  buoyancyC: number;
}

export interface ParcelAscent {
  /** One sample per input level, in the levels' published order. */
  levels: ReadonlyArray<ParcelLevelSample>;
  /** MSL; null when the column never saturates below its top. */
  lclM: number | null;
}

export interface ParcelOptions {
  /**
   * TRIAL craft parameter, caller-movable: bulk fractional entrainment
   * rate, per metre — the entraining-parcel relaxation
   * dX_parcel/dz += −λ (X_parcel − X_environment) for temperature and
   * vapour (Stull 1988, ch. 13). Default `DEFAULT_ENTRAINMENT_PER_M` (0):
   * an undiluted parcel.
   */
  entrainmentPerM?: number;
}

/**
 * ICAO standard atmosphere pressure, hPa, troposphere leg
 * (ISO 2533:1975): p(z) = 1013.25 (1 − 2.25577e-5 z)^5.25588. Pressure
 * enters the ascent only through the vapour conversions, where the
 * standard profile is accurate enough: a 20 hPa error moves a mixing
 * ratio ~2 % and a virtual temperature by hundredths of a degree.
 */
function isaPressureHpa(heightM: number): number {
  return 1013.25 * (1 - 2.25577e-5 * heightM) ** 5.25588;
}

/**
 * Moist pseudo-adiabatic lapse rate, degC per metre:
 * Γm = g (1 + Lv w_s / (Rd T)) / (cpd + Lv² w_s ε / (Rd T²))
 * (AMS Glossary, "moist-adiabatic lapse rate"; Bohren & Albrecht 1998),
 * with Lv held constant and w_s from the Magnus saturation curve.
 */
function moistLapseCPerM(temperatureC: number, pressureHpa: number): number {
  const temperatureK = temperatureC + 273.15;
  const ws = saturationMixingRatioKgKg(temperatureC, pressureHpa);
  return (
    (GRAVITY_MPS2 * (1 + (LV_J_PER_KG * ws) / (RD_J_PER_KG_K * temperatureK))) /
    (CPD_J_PER_KG_K +
      (LV_J_PER_KG * LV_J_PER_KG * ws * RD_OVER_RV) / (RD_J_PER_KG_K * temperatureK ** 2))
  );
}

interface EnvNode {
  heightM: number;
  temperatureC: number;
  dewPointC: number;
}

/** Linear interpolation of the environment column in height — internal integration support only; output samples sit exactly on published levels. */
function environmentAt(nodes: readonly EnvNode[], heightM: number): EnvNode {
  if (heightM <= nodes[0].heightM) return nodes[0];
  for (let index = 1; index < nodes.length; index += 1) {
    const upper = nodes[index];
    if (heightM <= upper.heightM) {
      const lower = nodes[index - 1];
      const fraction = (heightM - lower.heightM) / (upper.heightM - lower.heightM);
      return {
        heightM,
        temperatureC: lower.temperatureC + fraction * (upper.temperatureC - lower.temperatureC),
        dewPointC: lower.dewPointC + fraction * (upper.dewPointC - lower.dewPointC),
      };
    }
  }
  return nodes[nodes.length - 1];
}

/**
 * Lifts one surface parcel through the hour's published levels: dry
 * adiabatic below the lifting condensation level, moist pseudo-adiabatic
 * above it (condensate removed as it forms), buoyancy read in virtual
 * temperature so the vapour the parcel carries — and the vapour the
 * environment holds — both count toward density (Doswell & Rasmussen
 * 1994 on why virtual temperature belongs in parcel buoyancy).
 *
 * The LCL is found by the ascent itself: the height where the parcel's
 * conserved mixing ratio meets the Magnus saturation curve along the dry
 * adiabat — the same saturation physics as the moist branch, so the two
 * legs join without a seam. `lclM` is null when the column never
 * saturates below its top published level.
 *
 * Numbers are plain scalars (resolve ensembles to a percentile first).
 * Dew points above their temperature (supersaturated data noise) are
 * clamped to the temperature. Levels at or below the surface elevation
 * receive the unlifted surface parcel. Samples come out at exactly the
 * published levels, in published order — no resampling.
 */
export function parcelAscent(
  surface: { temperatureC: number; dewPointC: number; elevationM: number },
  levels: ReadonlyArray<{ heightM: number; temperatureC: number; dewPointC: number }>,
  options?: ParcelOptions,
): ParcelAscent {
  const entrainmentPerM = options?.entrainmentPerM ?? DEFAULT_ENTRAINMENT_PER_M;
  const surfaceHeightM = surface.elevationM;
  const surfaceDewPointC = Math.min(surface.dewPointC, surface.temperatureC);
  const surfacePressureHpa = isaPressureHpa(surfaceHeightM);
  const surfaceVapourKgKg = mixingRatioKgKg(surfaceDewPointC, surfacePressureHpa);

  const envNodes: EnvNode[] = [
    { heightM: surfaceHeightM, temperatureC: surface.temperatureC, dewPointC: surfaceDewPointC },
    ...[...levels]
      .filter((level) => level.heightM > surfaceHeightM)
      .sort((a, b) => a.heightM - b.heightM)
      .map((level) => ({
        heightM: level.heightM,
        temperatureC: level.temperatureC,
        dewPointC: Math.min(level.dewPointC, level.temperatureC),
      })),
  ];

  let heightM = surfaceHeightM;
  let tempC = surface.temperatureC;
  let vapourKgKg = surfaceVapourKgKg;
  let saturated =
    surfaceVapourKgKg >= saturationMixingRatioKgKg(surface.temperatureC, surfacePressureHpa);
  let lclM: number | null = saturated ? surfaceHeightM : null;

  // dT/dz and dw/dz for the current phase — the entraining-parcel terms
  // vanish at the default entrainmentPerM of 0.
  const derivative = (z: number, t: number, w: number): { dT: number; dW: number } => {
    const env = environmentAt(envNodes, z);
    const entrainT = -entrainmentPerM * (t - env.temperatureC);
    if (saturated) {
      return { dT: -moistLapseCPerM(t, isaPressureHpa(z)) + entrainT, dW: 0 };
    }
    const envVapour = mixingRatioKgKg(env.dewPointC, isaPressureHpa(z));
    return {
      dT: -DRY_ADIABATIC_LAPSE_C_PER_M + entrainT,
      dW: -entrainmentPerM * (w - envVapour),
    };
  };

  const stepTo = (targetM: number): void => {
    while (heightM < targetM) {
      const stepM = Math.min(ASCENT_STEP_M, targetM - heightM);
      // Midpoint (RK2) step.
      const k1 = derivative(heightM, tempC, vapourKgKg);
      const k2 = derivative(
        heightM + stepM / 2,
        tempC + (k1.dT * stepM) / 2,
        vapourKgKg + (k1.dW * stepM) / 2,
      );
      const nextTempC = tempC + k2.dT * stepM;
      const nextVapour = saturated ? vapourKgKg : vapourKgKg + k2.dW * stepM;
      const nextHeightM = heightM + stepM;

      if (!saturated) {
        const excessBefore = vapourKgKg - saturationMixingRatioKgKg(tempC, isaPressureHpa(heightM));
        const excessAfter =
          nextVapour - saturationMixingRatioKgKg(nextTempC, isaPressureHpa(nextHeightM));
        if (excessAfter >= 0) {
          // Saturation crossed inside this step: place the LCL by linear
          // interpolation of the excess, switch branches there.
          const fraction = excessBefore < 0 ? excessBefore / (excessBefore - excessAfter) : 0;
          const crossM = heightM + fraction * stepM;
          tempC = tempC + fraction * (nextTempC - tempC);
          heightM = crossM;
          saturated = true;
          lclM = crossM;
          vapourKgKg = saturationMixingRatioKgKg(tempC, isaPressureHpa(heightM));
          continue;
        }
      }

      tempC = nextTempC;
      heightM = nextHeightM;
      vapourKgKg = saturated
        ? saturationMixingRatioKgKg(tempC, isaPressureHpa(heightM))
        : nextVapour;
    }
  };

  const sampleByHeight = new Map<number, { parcelTempC: number; parcelVapourKgKg: number }>();
  const targets = [...new Set(levels.map((level) => level.heightM))].sort((a, b) => a - b);
  for (const targetM of targets) {
    if (targetM <= surfaceHeightM) {
      sampleByHeight.set(targetM, {
        parcelTempC: surface.temperatureC,
        parcelVapourKgKg: surfaceVapourKgKg,
      });
      continue;
    }
    stepTo(targetM);
    sampleByHeight.set(targetM, { parcelTempC: tempC, parcelVapourKgKg: vapourKgKg });
  }

  const samples: ParcelLevelSample[] = levels.map((level) => {
    const parcel = sampleByHeight.get(level.heightM)!;
    const pressureHpa = isaPressureHpa(level.heightM);
    const envDewPointC = Math.min(level.dewPointC, level.temperatureC);
    const envVirtualTempC = virtualTemperatureC(
      level.temperatureC,
      mixingRatioKgKg(envDewPointC, pressureHpa),
    );
    const parcelVirtualTempC = virtualTemperatureC(parcel.parcelTempC, parcel.parcelVapourKgKg);
    return {
      heightM: level.heightM,
      envTempC: level.temperatureC,
      envVirtualTempC,
      parcelTempC: parcel.parcelTempC,
      parcelVirtualTempC,
      buoyancyC: parcelVirtualTempC - envVirtualTempC,
    };
  });

  return { levels: samples, lclM };
}
