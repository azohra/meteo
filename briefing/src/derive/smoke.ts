import type { SmokeDocument, SmokeDocumentHour, SiteForecast } from "../contract.js";

/** Mass extinction efficiency of aged wildfire smoke at mid-visible wavelength, m²/g — converts a PM2.5 smoke column (mg/m²) into aerosol optical thickness; treat derived AOT as ±30–50 %. */
export const SMOKE_MASS_EXTINCTION_M2_PER_G = 4.7;

/** Effective broadband extinction coefficient for surface irradiance under smoke at midday sun (f = exp(−k·τ)) — far below exp(−τ) because smoke's scattering turns most extinction into diffuse light that still arrives. */
export const SMOKE_TRANSMITTANCE_K_MIDDAY = 0.16;

/** The zenith-aware companion of SMOKE_TRANSMITTANCE_K_MIDDAY: f = exp(−k·τ / cosθz) with k normalized to a vertical path. */
export const SMOKE_TRANSMITTANCE_K_VERTICAL = 0.13;

// Slant paths longer than ~1/0.15 air masses leave the parameterization's
// validity; irradiance is marginal there anyway.
const MIN_COS_ZENITH = 0.15;

/** Aerosol optical thickness (dimensionless, mid-visible) from a wildfire PM2.5 column, mg/m²; for profiles with their own smoke block prefer the published `aot` directly. */
export function smokeAotFromColumn(columnMgm2: number): number {
  if (!(columnMgm2 > 0)) return 0;
  return (columnMgm2 / 1000) * SMOKE_MASS_EXTINCTION_M2_PER_G;
}

/**
 * The factor f ∈ (0, 1] by which smoke of optical thickness `aot` reduces
 * surface global irradiance; with `cosZenith` supplied the slant path is
 * respected, and a non-positive cosine (sun down) returns 1.
 */
export function smokeTransmittance(aot: number, cosZenith?: number): number {
  if (!(aot > 0)) return 1;
  if (cosZenith === undefined) return Math.exp(-SMOKE_TRANSMITTANCE_K_MIDDAY * aot);
  if (cosZenith <= 0) return 1;
  const path = Math.max(cosZenith, MIN_COS_ZENITH);
  return Math.exp((-SMOKE_TRANSMITTANCE_K_VERTICAL * aot) / path);
}

/**
 * The smoke-adjusted convective velocity scale: w* × ∛f, from the
 * published w* alone. Never apply to a smoke-aware profile
 * (isSmokeAwareProfile): its published w* already includes the model's
 * own smoke attenuation.
 */
export function smokeAdjustedThermalVelocityMps(
  thermalVelocityMps: number,
  transmittance: number,
): number {
  if (!(thermalVelocityMps > 0)) return 0;
  const f = Math.min(Math.max(transmittance, 0), 1);
  return thermalVelocityMps * Math.cbrt(f);
}

/** True when the profile model's own radiation already feels its smoke, so a smoke derate on top would double-count; absence of the tag reads as smoke-blind. */
export function isSmokeAwareProfile(profile: SiteForecast): boolean {
  return profile.semantics?.smoke === "radiativelyCoupled";
}

/** A smoke document's hours keyed by validAt, for joining against `profile.hours`; hours the smoke document does not cover are simply absent. */
export function smokeHoursByValidAt(smoke: SmokeDocument): Map<string, SmokeDocumentHour> {
  return new Map(smoke.hours.map((hour) => [hour.validAt, hour]));
}

/** Cosine of the solar zenith angle at a UTC instant and location — the slant-path input for smokeTransmittance; negative means the sun is below the horizon. */
export function cosSolarZenith(validAt: string, latitudeDeg: number, longitudeDeg: number): number {
  const date = new Date(validAt);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - startOfYear) / 86_400_000;
  const gamma = (2 * Math.PI * dayOfYear) / 365;

  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const equationOfTimeMinutes =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarHours = utcHours + longitudeDeg / 15 + equationOfTimeMinutes / 60;
  const hourAngle = ((solarHours - 12) * 15 * Math.PI) / 180;

  const latitude = (latitudeDeg * Math.PI) / 180;
  return (
    Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle)
  );
}
