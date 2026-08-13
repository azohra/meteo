import type { Observation, ObservationDocument } from "../contract.js";

/** Clear-sky global horizontal irradiance, W/m², from the cosine of the solar zenith angle alone (Haurwitz: GHI = 1098 · cosθz · exp(−0.059 / cosθz)); zero when the sun is at or below the horizon. */
export function clearSkyGhiWm2(cosZenith: number): number {
  if (cosZenith <= 0) return 0;
  return 1098 * cosZenith * Math.exp(-0.059 / cosZenith);
}

const MIN_COS_ZENITH = 0.15;
const MAX_TRANSMITTANCE = 1.5;

/**
 * The fraction of the clear-sky expectation that actually arrived:
 * measured GHI over Haurwitz. Null when the sun is too low for the ratio
 * to mean anything; values modestly above 1 are real, and the result is
 * capped at 1.5 as an input-sanity bound.
 */
export function observedTransmittance(measuredWm2: number, cosZenith: number): number | null {
  if (cosZenith < MIN_COS_ZENITH) return null;
  if (!(measuredWm2 >= 0)) return null;
  const expectation = clearSkyGhiWm2(cosZenith);
  return Math.min(measuredWm2 / expectation, MAX_TRANSMITTANCE);
}

/**
 * The observation nearest an instant, within a tolerance — the join
 * primitive for putting measurements beside forecast hours: observations
 * sit at the product's native cadence, so an exact-key join never
 * matches. Null when nothing lies within the tolerance.
 */
export function nearestObservation(
  document: ObservationDocument,
  instant: string,
  maxOffsetMinutes = 30,
): { observation: Observation; offsetMinutes: number } | null {
  const target = Date.parse(instant);
  if (Number.isNaN(target)) return null;
  let best: { observation: Observation; offsetMinutes: number } | null = null;
  for (const observation of document.observations) {
    const offsetMinutes = Math.abs(Date.parse(observation.observedAt) - target) / 60_000;
    if (offsetMinutes > maxOffsetMinutes) continue;
    if (best === null || offsetMinutes < best.offsetMinutes) {
      best = { observation, offsetMinutes };
    }
  }
  return best;
}
