export const KMH_PER_MPS = 3.6;

export function kmhToMps(value: number): number {
  return value / KMH_PER_MPS;
}

/** m/s → km/h — the unit conversion behind every km/h readout. */
export function msToKmh(speedMps: number): number {
  return speedMps * KMH_PER_MPS;
}

/* Returns the wind speed unchanged, or throws when it is outside the plausible 0–140 m/s range. */
export function plausibleWindMps(value: number, subject: string): number {
  if (value < 0 || value > 140) {
    throw new Error(`${subject} returned an invalid wind speed`);
  }
  return value;
}
