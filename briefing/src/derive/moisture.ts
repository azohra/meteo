// Magnus form constants per Alduchov & Eskridge (1996, J. Appl. Meteor. 35,
// eq. 21): e_s(T) = 6.1094 exp(17.625 T / (243.04 + T)) hPa, T in degC.
const MAGNUS_A = 17.625;
const MAGNUS_B_C = 243.04;
const MAGNUS_ES0_HPA = 6.1094;

/** Ratio of dry-air to water-vapour gas constants, Rd/Rv (Wallace & Hobbs 2006, sec. 3.5.1). */
const EPSILON = 0.622;

function magnusGamma(temperatureC: number): number {
  return (MAGNUS_A * temperatureC) / (MAGNUS_B_C + temperatureC);
}

/**
 * Relative humidity (%) from temperature and dew point:
 * RH = 100 * e_s(Td) / e_s(T). Clamped to at most 100 so data noise with
 * Td slightly above T cannot report supersaturation.
 */
export function relativeHumidityPercent(temperatureC: number, dewPointC: number): number {
  return Math.min(100, 100 * Math.exp(magnusGamma(dewPointC) - magnusGamma(temperatureC)));
}

/**
 * Dew point (degC) from temperature and relative humidity, inverting the
 * Magnus form. RH is clamped into [1, 100]: above 100 returns exactly the
 * temperature, and zero, negative, or sub-1 % humidity evaluates at the
 * RH = 1 floor rather than producing NaN.
 */
export function dewPointC(temperatureC: number, relativeHumidityPercent: number): number {
  const rh = Math.min(100, Math.max(1, relativeHumidityPercent));
  const gamma = Math.log(rh / 100) + magnusGamma(temperatureC);
  return (MAGNUS_B_C * gamma) / (MAGNUS_A - gamma);
}

/** Dew-point depression (degC): T minus Td. Negative means supersaturated data. */
export function dewPointDepressionC(temperatureC: number, dewPointC: number): number {
  return temperatureC - dewPointC;
}

/**
 * Saturation vapour pressure over water, hPa — the Magnus form of
 * Alduchov & Eskridge (1996, J. Appl. Meteor. 35, eq. 21), the same
 * constants the humidity conversions above use.
 */
export function saturationVaporPressureHpa(temperatureC: number): number {
  return MAGNUS_ES0_HPA * Math.exp(magnusGamma(temperatureC));
}

/**
 * Water-vapour mixing ratio, kg/kg, from dew point and total pressure:
 * w = ε e / (p − e) with e = e_s(Td) (Wallace & Hobbs 2006, eq. 3.63).
 */
export function mixingRatioKgKg(dewPointC: number, pressureHpa: number): number {
  const e = saturationVaporPressureHpa(dewPointC);
  return (EPSILON * e) / (pressureHpa - e);
}

/** Saturation mixing ratio, kg/kg: the mixing ratio of just-saturated air, w_s = ε e_s(T) / (p − e_s(T)). */
export function saturationMixingRatioKgKg(temperatureC: number, pressureHpa: number): number {
  return mixingRatioKgKg(temperatureC, pressureHpa);
}

/**
 * Virtual temperature, degC — the temperature dry air would need to match
 * the moist air's density: T_v = T (1 + w/ε) / (1 + w), T in kelvin
 * (Wallace & Hobbs 2006, eq. 3.60).
 */
export function virtualTemperatureC(temperatureC: number, mixingRatioKgKg: number): number {
  const temperatureK = temperatureC + 273.15;
  return (temperatureK * (1 + mixingRatioKgKg / EPSILON)) / (1 + mixingRatioKgKg) - 273.15;
}
