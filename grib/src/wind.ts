import {
  eastNorth,
  rotateToEarth,
  rotateToGrid,
  toRadians,
  unitVector,
  wrapSigned,
} from "./sphere.js";
import type { Vec3 } from "./sphere.js";

/**
 * True east/north wind components from grid-relative components on a
 * rotated lat-lon grid (GRIB uvRelativeToGrid=1, angle of rotation 0).
 */
export function earthWind(
  uGridMs: number,
  vGridMs: number,
  latitude: number,
  longitude: number,
  southPoleLatitude: number,
  southPoleLongitude: number,
): [number, number] {
  const zAngle = toRadians(southPoleLongitude);
  const yAngle = toRadians(90 + southPoleLatitude);

  const latRad = toRadians(latitude);
  const lonRad = toRadians(longitude);
  const point = unitVector(latRad, lonRad);
  const rotatedPoint = rotateToGrid(point, zAngle, yAngle);
  const rotatedLat = Math.asin(Math.max(-1, Math.min(1, rotatedPoint[2])));
  const rotatedLon = Math.atan2(rotatedPoint[1], rotatedPoint[0]);

  const grid = eastNorth(rotatedLat, rotatedLon);
  const wind: Vec3 = [
    uGridMs * grid.east[0] + vGridMs * grid.north[0],
    uGridMs * grid.east[1] + vGridMs * grid.north[1],
    uGridMs * grid.east[2] + vGridMs * grid.north[2],
  ];
  const windGeo = rotateToEarth(wind, zAngle, yAngle);
  const truth = eastNorth(latRad, lonRad);
  return [
    windGeo[0] * truth.east[0] + windGeo[1] * truth.east[1] + windGeo[2] * truth.east[2],
    windGeo[0] * truth.north[0] + windGeo[1] * truth.north[1] + windGeo[2] * truth.north[2],
  ];
}

/**
 * The Lambert conformal cone constant: sin(latin1) for a tangent cone
 * (latin1 == latin2), else the secant form.
 */
export function lambertConeConstant(latin1Deg: number, latin2Deg: number): number {
  const phi1 = toRadians(latin1Deg);
  if (latin1Deg === latin2Deg) return Math.sin(phi1);
  const phi2 = toRadians(latin2Deg);
  return (
    Math.log(Math.cos(phi1) / Math.cos(phi2)) /
    Math.log(Math.tan(Math.PI / 4 + phi2 / 2) / Math.tan(Math.PI / 4 + phi1 / 2))
  );
}

/**
 * The angle from grid north to true north at a gridpoint's longitude, in
 * degrees.
 */
export function lambertGridRotationDeg(
  longitude: number,
  orientationDeg: number,
  cone: number,
): number {
  return cone * wrapSigned(longitude - orientationDeg, 180);
}

/** True east/north wind from grid-relative components on a Lambert grid. */
export function lambertEarthWind(
  uGrid: number,
  vGrid: number,
  longitude: number,
  orientationDeg: number,
  cone: number,
): [number, number] {
  const angle = toRadians(lambertGridRotationDeg(longitude, orientationDeg, cone));
  return [
    uGrid * Math.cos(angle) + vGrid * Math.sin(angle),
    -uGrid * Math.sin(angle) + vGrid * Math.cos(angle),
  ];
}
