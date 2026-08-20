export type Vec3 = readonly [number, number, number];

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Wraps an angle to its signed principal range [-halfPeriod, halfPeriod),
 * whatever the unit: pass 180 for degrees, Math.PI for radians. */
export function wrapSigned(value: number, halfPeriod: number): number {
  const period = 2 * halfPeriod;
  return ((((value + halfPeriod) % period) + period) % period) - halfPeriod;
}

export function unitVector(latRad: number, lonRad: number): Vec3 {
  return [
    Math.cos(latRad) * Math.cos(lonRad),
    Math.cos(latRad) * Math.sin(lonRad),
    Math.sin(latRad),
  ];
}

/** Local east and north tangent vectors at a point (radians). */
export function eastNorth(latRad: number, lonRad: number): { east: Vec3; north: Vec3 } {
  return {
    east: [-Math.sin(lonRad), Math.cos(lonRad), 0],
    north: [
      -Math.sin(latRad) * Math.cos(lonRad),
      -Math.sin(latRad) * Math.sin(lonRad),
      Math.cos(latRad),
    ],
  };
}

/** Geographic-frame vector expressed in the rotated frame: Rz(zAngle)
 * then Ry(yAngle). */
export function rotateToGrid(v: Vec3, zAngle: number, yAngle: number): Vec3 {
  const x = v[0] * Math.cos(zAngle) + v[1] * Math.sin(zAngle);
  const y = -v[0] * Math.sin(zAngle) + v[1] * Math.cos(zAngle);
  return [
    x * Math.cos(yAngle) + v[2] * Math.sin(yAngle),
    y,
    -x * Math.sin(yAngle) + v[2] * Math.cos(yAngle),
  ];
}

/** Rotated-frame vector expressed back in the geographic frame — the
 * inverse of rotateToGrid. */
export function rotateToEarth(v: Vec3, zAngle: number, yAngle: number): Vec3 {
  const x = v[0] * Math.cos(yAngle) - v[2] * Math.sin(yAngle);
  const z = v[0] * Math.sin(yAngle) + v[2] * Math.cos(yAngle);
  return [
    x * Math.cos(zAngle) - v[1] * Math.sin(zAngle),
    x * Math.sin(zAngle) + v[1] * Math.cos(zAngle),
    z,
  ];
}

/** Geographic point → coordinates in the rotated lat-lon frame (degrees). */
export function toRotated(
  latitude: number,
  longitude: number,
  southPoleLatitude: number,
  southPoleLongitude: number,
): { latitude: number; longitude: number } {
  const zAngle = toRadians(southPoleLongitude);
  const yAngle = toRadians(90 + southPoleLatitude);
  const point = rotateToGrid(unitVector(toRadians(latitude), toRadians(longitude)), zAngle, yAngle);
  return {
    latitude: toDegrees(Math.asin(Math.max(-1, Math.min(1, point[2])))),
    longitude: toDegrees(Math.atan2(point[1], point[0])),
  };
}

/** Rotated-frame point → geographic coordinates in degrees; longitude in
 * (-180, 180]. */
export function fromRotated(
  rotatedLatitude: number,
  rotatedLongitude: number,
  southPoleLatitude: number,
  southPoleLongitude: number,
): { latitude: number; longitude: number } {
  const zAngle = toRadians(southPoleLongitude);
  const yAngle = toRadians(90 + southPoleLatitude);
  const point = rotateToEarth(
    unitVector(toRadians(rotatedLatitude), toRadians(rotatedLongitude)),
    zAngle,
    yAngle,
  );
  return {
    latitude: toDegrees(Math.asin(Math.max(-1, Math.min(1, point[2])))),
    longitude: toDegrees(Math.atan2(point[1], point[0])),
  };
}

/** Great-circle distance in km. An out-of-range dot product is clamped by
 * integer truncation — the recorded golden distances depend on exactly
 * that clamp. */
export function greatCircleDistanceKm(
  radiusKm: number,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const rlat1 = toRadians(lat1);
  const rlat2 = toRadians(lat2);
  let a =
    Math.sin(rlat1) * Math.sin(rlat2) +
    Math.cos(rlat1) * Math.cos(rlat2) * Math.cos(toRadians(lon2 - lon1));
  if (a > 1 || a < -1) a = Math.trunc(a);
  return radiusKm * Math.acos(a);
}
