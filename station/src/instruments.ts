import type { DirectionArc } from "@azohra/meteo.core";
import type { HistoryPoint } from "./contract.js";
import { COMPASS_POINTS, KMH_PER_MPS, normalizeDegrees, radians, speedToMps } from "./derive.js";
import type { SpeedUnit } from "./derive.js";
import { HISTORY_GAP_TOLERANCE_FACTOR } from "./geometry.js";

export const DIAL_SIZE = 160;
export const DIAL_CENTRE = DIAL_SIZE / 2;
export const DIAL_RING_RADIUS = 70;
export const DIAL_TICK_INNER = 64;
export const DIAL_CARDINAL_TICK_INNER = 58;
export const DIAL_LETTER_RADIUS = 46;
export const DIAL_HUB_RADIUS = 36;
const DIAL_NEEDLE_REACH = 60;
const DIAL_NEEDLE_HALF_WIDTH = 5;
export const DIAL_COUNTERWEIGHT_RADIUS = 4.5;
export const DIAL_COUNTERWEIGHT_REACH = 46;
export const DIAL_MIN_MAX_MPS = 40 / KMH_PER_MPS;

/* Trig can differ by one ulp between CPU architectures; rounding keeps
 * rendered markup identical wherever it is produced. */
const roundCoordinate = (value: number) => Math.round(value * 1000) / 1000;

export function dialPolar(bearingDeg: number, radius: number): readonly [number, number] {
  const angle = radians(bearingDeg);
  return [
    roundCoordinate(DIAL_CENTRE + Math.sin(angle) * radius),
    roundCoordinate(DIAL_CENTRE - Math.cos(angle) * radius),
  ];
}

const dialAt = ([x, y]: readonly [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;

export function dialNeedlePoints(fromDeg: number): string {
  const flowDeg = fromDeg + 180;
  const tip = dialPolar(flowDeg, DIAL_NEEDLE_REACH);
  const left = dialPolar(flowDeg + 90, DIAL_NEEDLE_HALF_WIDTH);
  const right = dialPolar(flowDeg - 90, DIAL_NEEDLE_HALF_WIDTH);
  return `${dialAt(tip)} ${dialAt(left)} ${dialAt(right)}`;
}

/* The dial's verdict ring rides the bezel radius, mirroring the rose's:
 * a favorable arc painted over the full unfavorable circle. */
export function dialRingArcPath(sector: FavorableDirection): string {
  const from = normalizeDegrees(sector.fromDeg);
  const span = normalizeDegrees(sector.toDeg - sector.fromDeg);
  const start = dialPolar(from, DIAL_RING_RADIUS);
  const end = dialPolar(from + span, DIAL_RING_RADIUS);
  return `M ${dialAt(start)} A ${DIAL_RING_RADIUS} ${DIAL_RING_RADIUS} 0 ${
    span > 180 ? 1 : 0
  } 1 ${dialAt(end)}`;
}

export function dialSpeedArcPath(fraction: number): string {
  const sweepDeg = Math.min(359.9, Math.max(0, fraction) * 360);
  const start = dialPolar(0, DIAL_RING_RADIUS);
  const end = dialPolar(sweepDeg, DIAL_RING_RADIUS);
  return `M ${start[0].toFixed(1)} ${start[1].toFixed(1)} A ${DIAL_RING_RADIUS} ${DIAL_RING_RADIUS} 0 ${
    sweepDeg > 180 ? 1 : 0
  } 1 ${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
}

export function dialScaleMaxMps(
  windAvgMps: number | null,
  windGustMps: number | null,
  unit: SpeedUnit,
): number {
  const stepMps = speedToMps(10, unit);
  return Math.max(
    DIAL_MIN_MAX_MPS,
    Math.ceil(Math.max(windGustMps ?? 0, windAvgMps ?? 0) / stepMps) * stepMps,
  );
}

export const DIAL_CARDINALS = [
  { bearing: 0, letter: COMPASS_POINTS[0] },
  { bearing: 90, letter: COMPASS_POINTS[4] },
  { bearing: 180, letter: COMPASS_POINTS[8] },
  { bearing: 270, letter: COMPASS_POINTS[12] },
] as const;

export const ROSE_SIZE = 190;
export const ROSE_CENTRE = ROSE_SIZE / 2;
export const ROSE_MAX_RADIUS = 70;
export const ROSE_FAVORABLE_RING_RADIUS = 75;
export const ROSE_HUB_RADIUS = 16;
export const ROSE_HUB_DOT_RADIUS = 3;
export const ROSE_LETTER_RADIUS = 82;
export const ROSE_TICK_REACH = 4;
export const ROSE_PETAL_FILL = 0.82;

export function rosePolar(bearingDeg: number, radius: number): readonly [number, number] {
  const angle = radians(bearingDeg);
  return [
    roundCoordinate(ROSE_CENTRE + Math.sin(angle) * radius),
    roundCoordinate(ROSE_CENTRE - Math.cos(angle) * radius),
  ];
}

const roseAt = ([x, y]: readonly [number, number]) => `${x.toFixed(1)} ${y.toFixed(1)}`;

export function rosePetalPath(bearingDeg: number, radius: number, halfWidthDeg: number): string {
  return roseBandPath(bearingDeg, ROSE_HUB_RADIUS, radius, halfWidthDeg);
}

/** One radial slice of a petal — a stacked wedge's band segment; the petal
 * itself is the slice from the hub out. */
export function roseBandPath(
  bearingDeg: number,
  innerRadius: number,
  outerRadius: number,
  halfWidthDeg: number,
): string {
  const outerLeft = rosePolar(bearingDeg - halfWidthDeg, outerRadius);
  const outerRight = rosePolar(bearingDeg + halfWidthDeg, outerRadius);
  const innerLeft = rosePolar(bearingDeg - halfWidthDeg, innerRadius);
  const innerRight = rosePolar(bearingDeg + halfWidthDeg, innerRadius);
  /* An integer radius prints bare (the hub always did), a computed one to
   * one decimal — keeping every already-published petal path byte-stable. */
  const arcRadius = (radius: number) =>
    Number.isInteger(radius) ? String(radius) : radius.toFixed(1);
  return [
    `M ${roseAt(innerLeft)}`,
    `L ${roseAt(outerLeft)}`,
    `A ${outerRadius.toFixed(1)} ${outerRadius.toFixed(1)} 0 0 1 ${roseAt(outerRight)}`,
    `L ${roseAt(innerRight)}`,
    `A ${arcRadius(innerRadius)} ${arcRadius(innerRadius)} 0 0 0 ${roseAt(innerLeft)}`,
    "Z",
  ].join(" ");
}

/** The rose ring's arc input; the shape is core's `DirectionArc`. */
export type FavorableDirection = DirectionArc;

export function roseRingArcPath(sector: FavorableDirection): string {
  const from = normalizeDegrees(sector.fromDeg);
  const span = normalizeDegrees(sector.toDeg - sector.fromDeg);
  const start = rosePolar(from, ROSE_FAVORABLE_RING_RADIUS);
  const end = rosePolar(from + span, ROSE_FAVORABLE_RING_RADIUS);
  return `M ${roseAt(start)} A ${ROSE_FAVORABLE_RING_RADIUS} ${ROSE_FAVORABLE_RING_RADIUS} 0 ${
    span > 180 ? 1 : 0
  } 1 ${roseAt(end)}`;
}

export const ROSE_CARDINAL_LETTERS = [
  { bearing: 0, letter: "N" },
  { bearing: 90, letter: "E" },
  { bearing: 180, letter: "S" },
  { bearing: 270, letter: "W" },
] as const;

export const ROSE_INTERCARDINAL_BEARINGS = [45, 135, 225, 315] as const;

export const SPARKLINE_EDGE_INSET = 1;
export const SPARKLINE_MAX_PADDING = 1.1;

export function sparklineScale(
  points: ReadonlyArray<HistoryPoint>,
  width: number,
  height: number,
): { scaleMax: number; xAt(ms: number): number; yAt(speedMps: number): number } {
  const first = points[0];
  const last = points[points.length - 1];
  const startMs = first ? Date.parse(first.observedAt) : 0;
  const durationMs = Math.max(1, (last ? Date.parse(last.observedAt) : startMs) - startMs);
  const top = points.reduce(
    (max, point) => Math.max(max, point.windGustMps ?? point.windAvgMps),
    0,
  );
  const scaleMax = top > 0 ? top * SPARKLINE_MAX_PADDING : 1;
  return {
    scaleMax,
    xAt: (ms) =>
      SPARKLINE_EDGE_INSET + ((ms - startMs) / durationMs) * (width - 2 * SPARKLINE_EDGE_INSET),
    yAt: (speedMps) =>
      height - SPARKLINE_EDGE_INSET - (speedMps / scaleMax) * (height - 2 * SPARKLINE_EDGE_INSET),
  };
}

export type HistoryRun = { startedAt: string; points: HistoryPoint[] };

export function historyRuns(
  points: ReadonlyArray<HistoryPoint>,
  periodMinutes: number,
): HistoryRun[] {
  const gapLimitMs = periodMinutes * 60_000 * HISTORY_GAP_TOLERANCE_FACTOR;
  const runs: HistoryRun[] = [];
  let run: HistoryRun | null = null;
  let previousMs = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const ms = Date.parse(point.observedAt);
    if (run != null && ms - previousMs > gapLimitMs) run = null;
    if (run == null) {
      run = { startedAt: point.observedAt, points: [] };
      runs.push(run);
    }
    run.points.push(point);
    previousMs = ms;
  }
  return runs;
}

export function bandStrips(runs: ReadonlyArray<HistoryRun>): HistoryRun[] {
  const strips: HistoryRun[] = [];
  for (const segment of runs) {
    let strip: HistoryRun | null = null;
    for (const point of segment.points) {
      if (point.windGustMps == null || point.windLullMps == null) {
        strip = null;
        continue;
      }
      if (strip == null) {
        strip = { startedAt: point.observedAt, points: [] };
        strips.push(strip);
      }
      strip.points.push(point);
    }
  }
  return strips;
}
