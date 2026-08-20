import type { AltitudeTick, PressureAltitudeTick } from "./types.js";

/**
 * The altitude axis both charts share — the Meteogram and the sounding
 * draw the same vertical world, so its domain rule, its y↔altitude map,
 * and its tick furniture live here and nowhere else.
 */

export const M_TO_FT = 3.28084;

/** How far apart two pressure ticks must sit before both draw. */
const PRESSURE_TICK_MIN_GAP_M = 80;

/** The linear plot scale a y↔altitude conversion needs — structurally a subset of both scene graphs' `scales`. */
export interface AltitudeScale {
  plotTop: number;
  plotHeight: number;
  floorM: number;
  topM: number;
}

/** Plot y for an altitude on the shared linear scale. */
export function yForAltitude(scale: AltitudeScale, altitudeM: number): number {
  const { plotTop, plotHeight, floorM, topM } = scale;
  return plotTop + plotHeight * (1 - (altitudeM - floorM) / (topM - floorM));
}

/** Altitude for a plot y — `yForAltitude`'s exact inverse. */
export function altitudeForY(scale: AltitudeScale, y: number): number {
  const { plotTop, plotHeight, floorM, topM } = scale;
  return topM - ((y - plotTop) / plotHeight) * (topM - floorM);
}

/**
 * The altitude-domain rule: at least 800 m of air above the floor, the
 * launch kept in frame when the caller admits it (`launchM`; pass null to
 * leave it out), every admitted candidate and published level inside, and
 * 4% headroom on top. Which candidates an overlay admits is the caller's
 * truth — the Meteogram raises the domain for its pblHeight overlay, the
 * sounding has none — so the candidates arrive as data.
 */
export function altitudeDomainTopM(
  floorM: number,
  launchM: number | null,
  candidates: Iterable<number | null | undefined>,
): number {
  let topM = Math.max(floorM + 800, launchM ?? floorM);
  for (const candidate of candidates) {
    if (candidate != null && candidate > topM) topM = candidate;
  }
  return topM * 1.04;
}

/** The six evenly spaced altitude ticks (floor to top), labeled in both metres and feet. */
export function altitudeAxisTicks(
  floorM: number,
  topM: number,
  y: (altitudeM: number) => number,
): AltitudeTick[] {
  const ticks: AltitudeTick[] = [];
  for (let tick = 0; tick <= 5; tick += 1) {
    const altitudeM = floorM + ((topM - floorM) * tick) / 5;
    ticks.push({
      altitudeM,
      y: y(altitudeM),
      labelMetres: `${Math.round(altitudeM)}m`,
      labelFeet: `${Math.round(altitudeM * M_TO_FT)}ft`,
    });
  }
  return ticks;
}

/**
 * Pressure ticks: the median published height per isobaric level across
 * the whole profile, plus the model-elevation row (null pressure), sorted
 * and thinned to an 80 m minimum gap — stable across hour selections even
 * where one hour's own level heights differ. `clampTopM` keeps ticks
 * inside a caller-cut domain (the sounding's `topM` option); the Meteogram
 * passes none, its domain already contains every level.
 */
export function pressureAltitudeTicks(
  hours: ReadonlyArray<{ levels: ReadonlyArray<{ pressureHpa: number; heightM: number }> }>,
  floorM: number,
  y: (altitudeM: number) => number,
  clampTopM?: number,
): PressureAltitudeTick[] {
  const byPressure = new Map<number, number[]>();
  for (const hour of hours) {
    for (const level of hour.levels) {
      const heights = byPressure.get(level.pressureHpa) ?? [];
      heights.push(level.heightM);
      byPressure.set(level.pressureHpa, heights);
    }
  }
  const entries = [
    { altitudeM: Math.round(floorM), pressureHpa: null as number | null },
    ...[...byPressure.entries()].map(([pressureHpa, heights]) => ({
      altitudeM: Math.round(median(heights)),
      pressureHpa: pressureHpa as number | null,
    })),
  ];
  return (
    clampTopM === undefined
      ? entries
      : entries.filter((entry) => entry.altitudeM >= floorM && entry.altitudeM <= clampTopM)
  )
    .sort((left, right) => left.altitudeM - right.altitudeM)
    .filter(
      (entry, index, thinned) =>
        index === 0 || entry.altitudeM - thinned[index - 1].altitudeM >= PRESSURE_TICK_MIN_GAP_M,
    )
    .map((entry) => ({ ...entry, y: y(entry.altitudeM) }));
}

/** The midpoint-averaging median both tick builders round from. */
export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
