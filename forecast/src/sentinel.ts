export const SENTINEL_TOLERANCE = 0.5;

export function isSentinel(value: number, sentinel: number): boolean {
  return Math.abs(value - sentinel) <= SENTINEL_TOLERANCE;
}

export function maskSentinel(value: number, sentinel: number): number | null {
  return isSentinel(value, sentinel) ? null : value;
}
