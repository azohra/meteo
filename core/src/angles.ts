export const DEGREES_TO_RADIANS = Math.PI / 180;

export function degreesToRadians(degrees: number): number {
  return degrees * DEGREES_TO_RADIANS;
}

// x/(π/180) and x*(180/π) can differ in the last ulp. Core pins the
// divide spelling; a consumer whose published output pins the multiply
// spelling keeps its own local form and says so at the site.
export function radiansToDegrees(radians: number): number {
  return radians / DEGREES_TO_RADIANS;
}

/* Wraps any degree value into [0, 360). */
export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
