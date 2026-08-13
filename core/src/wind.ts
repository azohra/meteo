import { degreesToRadians, normalizeDegrees, radiansToDegrees } from "./angles.js";

export interface WindComponents {
  /** Zonal component, m/s, positive eastward. */
  uMps: number;
  /** Meridional component, m/s, positive northward. */
  vMps: number;
}

/** Components from speed and meteorological direction (from-direction). */
export function windToComponents(speedMps: number, directionDeg: number): WindComponents {
  const radians = degreesToRadians(directionDeg);
  return {
    uMps: -speedMps * Math.sin(radians),
    vMps: -speedMps * Math.cos(radians),
  };
}

/** Speed and meteorological direction from components; calm air (both components zero) reports direction 0. */
export function componentsToWind(
  uMps: number,
  vMps: number,
): { speedMps: number; directionDeg: number } {
  const speedMps = Math.hypot(uMps, vMps);
  if (speedMps === 0) return { speedMps: 0, directionDeg: 0 };
  return {
    speedMps,
    directionDeg: normalizeDegrees(radiansToDegrees(Math.atan2(-uMps, -vMps))),
  };
}

/** Unit-vector circular mean of from-directions, weighting every direction equally; null on empty input. */
export function meanDirectionDeg(directionsDeg: ReadonlyArray<number>): number | null {
  if (directionsDeg.length === 0) return null;
  let sin = 0;
  let cos = 0;
  for (const directionDeg of directionsDeg) {
    const radians = degreesToRadians(directionDeg);
    sin += Math.sin(radians);
    cos += Math.cos(radians);
  }
  return normalizeDegrees(radiansToDegrees(Math.atan2(sin, cos)));
}
