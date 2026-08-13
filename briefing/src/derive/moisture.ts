const MAGNUS_A = 17.625;
const MAGNUS_B_C = 243.04;

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
