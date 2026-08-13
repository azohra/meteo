import type { HistoryPoint } from "./contract.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smoothstep clamped to [0, 1]. */
export const smooth = (value: number): number => {
  const u = Math.min(1, Math.max(0, value));
  return u * u * (3 - 2 * u);
};

/** Deterministic wobble in roughly [-1, 1]. */
export const wobble = (seed: number): number =>
  (Math.sin(seed * 12.9898) + Math.sin(seed * 4.1414 + 1.3)) / 2;

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;
const mps = (kmh: number): number => round2(kmh / 3.6);
const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;

function seasonPhase(dateUtc: Date): number {
  const solsticeMs = Date.UTC(dateUtc.getUTCFullYear(), 11, 21);
  const anchored =
    dateUtc.getTime() >= solsticeMs ? solsticeMs : Date.UTC(dateUtc.getUTCFullYear() - 1, 11, 21);
  return ((dateUtc.getTime() - anchored) / (365.25 * DAY_MS)) % 1;
}

export interface LongHistoryOptions {
  /** The series ends here. */
  nowMs: number;
  /** How many days of history to build. */
  days?: number;
  /** Sample cadence. */
  periodMinutes?: number;
  seed?: number;
  /** Punch a few multi-hour dropouts in. */
  withGaps?: boolean;
}

/** A long-range deterministic synthetic history: seasonal, diurnal, with occasional dropouts. */
export function buildLongHistory({
  nowMs,
  days = 420,
  periodMinutes = 15,
  seed = 0x5eed_1e5,
  withGaps = true,
}: LongHistoryOptions): HistoryPoint[] {
  const rand = mulberry32(seed);
  const totalSamples = Math.round((days * DAY_MS) / (periodMinutes * MINUTE_MS));
  const anchorMs = Math.floor(nowMs / (periodMinutes * MINUTE_MS)) * periodMinutes * MINUTE_MS;
  const gapStartIndexes = withGaps
    ? Array.from({ length: 6 }, () => Math.floor(rand() * (totalSamples - 40)) + 20)
    : [];
  const gapLengthSamples = Math.max(2, Math.round((3 * 60) / periodMinutes));

  const points: HistoryPoint[] = [];
  for (let index = 0; index < totalSamples; index += 1) {
    const sampleMs = anchorMs - (totalSamples - 1 - index) * periodMinutes * MINUTE_MS;
    if (gapStartIndexes.some((start) => index >= start && index < start + gapLengthSamples)) {
      continue;
    }

    const date = new Date(sampleMs);
    const minuteOfDay = date.getUTCHours() * 60 + date.getUTCMinutes();
    const dayFraction = minuteOfDay / 1440;
    const diurnal = smooth((dayFraction - 0.32) / 0.24) * (1 - smooth((dayFraction - 0.72) / 0.22));

    const season = seasonPhase(date);
    const summerWeight = smooth(1 - Math.abs(season - 0.5) * 2.4);
    const strength = 0.35 + 0.9 * summerWeight;
    const scatter = 60 - 34 * summerWeight;

    const noise = wobble(index * 0.7) * 0.5 + wobble(index * 3.1 + 11) * 0.5;
    const average = Math.max(0, round1(diurnal * strength * (16 + noise * 6)));
    const calm = average < 0.5;
    const gust = calm ? 0 : mps(average * 1.3 + 2 + Math.abs(noise) * 4);
    const lull = calm ? 0 : mps(Math.max(0, average * 0.6 - 1));
    const bearing = calm ? null : round1(normalizeDeg(225 + noise * scatter));

    const temperature = round1(
      8 + 14 * summerWeight + 6 * smooth((dayFraction - 0.3) / 0.4) + wobble(index * 5) * 1.5,
    );

    points.push({
      observedAt: new Date(sampleMs).toISOString(),
      windAvgMps: mps(average),
      windGustMps: gust,
      windLullMps: lull,
      windDirectionDeg: bearing,
      temperatureC: temperature,
    });
  }
  return points;
}
