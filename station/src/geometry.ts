import type { History, HistoryPoint } from "./contract.js";
import {
  componentsToWind,
  inDirectionArcs,
  meanDirectionDeg as meanOfDirections,
  windToComponents,
  type DirectionArc,
} from "@azohra/meteo.core";
import { CALM_THRESHOLD_MPS, KMH_PER_MPS, isCalm, normalizeDegrees, radians } from "./derive.js";

export type ChartFrame = {
  height: number;
  labelRow: number;
  left: number;
  plotBottom: number;
  plotTop: number;
  right: number;
  vaneLabelRow: number;
  vaneRow: number;
  valueRow: number;
  width: number;
};

export const CHART_FALLBACK_WIDTH = 360;
const CHART_AXIS_GUTTER = 46;
export const VANE_TARGET = 13;

/* The measure-before-framing rule: build the frame at the container's
 * measured pixel width, falling back only while nothing has been measured.
 * A fixed viewBox stretched by CSS magnifies every label and stroke. */
export function measuredChartWidth(measured: number): number {
  return measured > 0 ? Math.round(measured) : CHART_FALLBACK_WIDTH;
}

export type TickAnchor = "end" | "middle" | "start";

/* Edge time labels anchor inward so the first and last never clip. */
export function tickAnchor(index: number, lastIndex: number): TickAnchor {
  return index === 0 ? "start" : index === lastIndex ? "end" : "middle";
}

export function chartFrame(width: number): ChartFrame {
  const plotHeight = width < 520 ? 76 : 116;
  const plotTop = 10;
  const plotBottom = plotTop + plotHeight;
  return {
    height: plotBottom + 64,
    labelRow: plotBottom + 58,
    left: CHART_AXIS_GUTTER,
    plotBottom,
    plotTop,
    right: Math.max(CHART_AXIS_GUTTER + 40, width - 6),
    vaneLabelRow: plotBottom + 12,
    vaneRow: plotBottom + 26,
    valueRow: plotBottom + 40,
    width,
  };
}

export type ChartScales = {
  startMs: number;
  endMs: number;
  durationMs: number;
  scaleMax: number;
  xAtMs: (ms: number) => number;
  xAt: (observedAt: string) => number;
  yAt: (speedMps: number) => number;
};

export type ChartScaleOptions = {
  niceStepMps?: number;
  floorMps?: number;
};

const DEFAULT_NICE_STEP_MPS = 5 / KMH_PER_MPS;
const DEFAULT_FLOOR_MPS = 10 / KMH_PER_MPS;

export function chartScales(
  points: ReadonlyArray<HistoryPoint>,
  frame: ChartFrame,
  options: ChartScaleOptions = {},
): ChartScales {
  const niceStepMps = options.niceStepMps ?? DEFAULT_NICE_STEP_MPS;
  const floorMps = options.floorMps ?? DEFAULT_FLOOR_MPS;
  const first = points[0];
  const startMs = first ? Date.parse(first.observedAt) : 0;
  const last = points[points.length - 1];
  const endMs = last ? Date.parse(last.observedAt) : startMs;
  const durationMs = Math.max(1, endMs - startMs);
  const top = points.reduce(
    (max, point) => Math.max(max, point.windGustMps ?? point.windAvgMps),
    0,
  );
  const scaleMax = Math.max(floorMps, Math.ceil(top / niceStepMps) * niceStepMps);
  const xAtMs = (ms: number) =>
    frame.left + ((ms - startMs) / durationMs) * (frame.right - frame.left);
  return {
    startMs,
    endMs,
    durationMs,
    scaleMax,
    xAtMs,
    xAt: (observedAt) => xAtMs(Date.parse(observedAt)),
    yAt: (speedMps) =>
      frame.plotBottom - (speedMps / scaleMax) * (frame.plotBottom - frame.plotTop),
  };
}

export function valueScale(
  values: ReadonlyArray<number | null>,
  frame: ChartFrame,
  options: { paddingMin: number },
): { min: number; max: number; yAt(value: number): number } {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value == null) continue;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (low > high) {
    low = 0;
    high = 0;
  }
  const min = low - options.paddingMin;
  const max = high + options.paddingMin;
  return {
    min,
    max,
    yAt: (value) =>
      frame.plotBottom - ((value - min) / (max - min)) * (frame.plotBottom - frame.plotTop),
  };
}

const coordinate = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

export function bandPoints(
  points: ReadonlyArray<HistoryPoint>,
  scales: ChartScales,
): string | null {
  if (points.length === 0) return null;
  if (points.some((point) => point.windGustMps == null || point.windLullMps == null)) return null;
  const gust = points.map((point) =>
    coordinate(scales.xAt(point.observedAt), scales.yAt(point.windGustMps as number)),
  );
  const lull = [...points]
    .reverse()
    .map((point) =>
      coordinate(scales.xAt(point.observedAt), scales.yAt(point.windLullMps as number)),
    );
  return [...gust, ...lull].join(" ");
}

export function averagePoints(points: ReadonlyArray<HistoryPoint>, scales: ChartScales): string {
  return points
    .map((point) => coordinate(scales.xAt(point.observedAt), scales.yAt(point.windAvgMps)))
    .join(" ");
}

export function meanDirectionDeg(points: ReadonlyArray<HistoryPoint>): number | null {
  const blowing = points.filter(
    (point) => !isCalm(point.windAvgMps) && point.windDirectionDeg != null,
  );
  return meanOfDirections(blowing.map((point) => point.windDirectionDeg as number));
}

export type WindVector = { windDirectionDeg: number | null; speedMps: number };

export function vectorMeanWind(points: ReadonlyArray<HistoryPoint>): WindVector {
  if (points.length === 0) return { windDirectionDeg: null, speedMps: 0 };
  let u = 0;
  let v = 0;
  for (const point of points) {
    if (point.windDirectionDeg == null) continue;
    const components = windToComponents(point.windAvgMps, point.windDirectionDeg);
    u += components.uMps;
    v += components.vMps;
  }
  const mean = componentsToWind(u / points.length, v / points.length);
  return {
    windDirectionDeg: mean.speedMps < CALM_THRESHOLD_MPS ? null : mean.directionDeg,
    speedMps: mean.speedMps,
  };
}

export type Vane = {
  windAvgMps: number;
  windDirectionDeg: number | null;
  endIndex: number;
  midMs: number;
  startIndex: number;
};

export function thinVanes(
  points: ReadonlyArray<HistoryPoint>,
  target: number = VANE_TARGET,
): Vane[] {
  if (points.length === 0) return [];
  const step = Math.max(1, Math.round(points.length / target));
  return Array.from({ length: Math.ceil(points.length / step) }, (_, index) => {
    const startIndex = index * step;
    const endIndex = startIndex + step;
    const window = points.slice(startIndex, endIndex);
    const first = Date.parse((window[0] as HistoryPoint).observedAt);
    const last = Date.parse((window[window.length - 1] as HistoryPoint).observedAt);
    return {
      windAvgMps: window.reduce((sum, point) => sum + point.windAvgMps, 0) / window.length,
      windDirectionDeg: meanDirectionDeg(window),
      endIndex,
      midMs: first + (last - first) / 2,
      startIndex,
    };
  });
}

export function vanePath(
  cx: number,
  cy: number,
  fromBearingDeg: number,
  { reach = 7, spread = 3.2 }: { reach?: number; spread?: number } = {},
): string {
  const angle = radians(fromBearingDeg + 180);
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const tip = [cx + sin * reach, cy - cos * reach] as const;
  const tail = [cx - sin * reach, cy + cos * reach] as const;
  const left = [
    tip[0] - sin * spread + cos * spread,
    tip[1] + cos * spread + sin * spread,
  ] as const;
  const right = [
    tip[0] - sin * spread - cos * spread,
    tip[1] + cos * spread - sin * spread,
  ] as const;
  const at = ([px, py]: readonly [number, number]) => `${px.toFixed(1)} ${py.toFixed(1)}`;
  return `M ${at(tail)} L ${at(tip)} M ${at(left)} L ${at(tip)} L ${at(right)}`;
}

export type ChartTick = { index: number; timeMs: number; x: number };

export function vaneTicks(
  vanes: ReadonlyArray<Vane>,
  scales: ChartScales,
  labelCount = 5,
): ChartTick[] {
  if (vanes.length === 0) return [];
  /* Floor 2 (the ends), ceiling 5; the caller passes what its width seats. */
  const count = Math.max(2, Math.min(5, Math.floor(labelCount)));
  return Array.from({ length: count }, (_, index) => index / (count - 1)).map((fraction, index) => {
    const vane = vanes[Math.round(fraction * (vanes.length - 1))] as Vane;
    return { index, timeMs: vane.midMs, x: scales.xAtMs(vane.midMs) };
  });
}

/* Typed on the instant alone, so history points and live samples inspect
 * through the same cursor math. */
export function nearestIndex(
  points: ReadonlyArray<{ observedAt: string }>,
  chartX: number,
  frame: ChartFrame,
  scales: ChartScales,
): number | null {
  if (points.length === 0) return null;
  const ms =
    scales.startMs + ((chartX - frame.left) / (frame.right - frame.left)) * scales.durationMs;
  return points.reduce(
    (nearest, point, index) =>
      Math.abs(Date.parse(point.observedAt) - ms) <
      Math.abs(Date.parse((points[nearest] as { observedAt: string }).observedAt) - ms)
        ? index
        : nearest,
    0,
  );
}

export function isCalmHistory(points: ReadonlyArray<HistoryPoint>): boolean {
  return points.every((point) => isCalm(point.windGustMps ?? point.windAvgMps));
}

export function speedBand(speedMps: number, thresholdsMps: ReadonlyArray<number>): number {
  let band = 0;
  for (const bound of thresholdsMps) {
    if (speedMps < bound) return band;
    band += 1;
  }
  return band;
}

export type RoseSector = {
  bearingDeg: number;
  frequency: number;
  meanSpeedMps: number | null;
  maxGustMps: number | null;
  count: number;
  /** Non-calm records per speed band, present only when the caller passed
   * bandThresholdsMps — stacking is a judgment the consumer supplies. */
  bandCounts?: number[] | undefined;
};

export type WindRoseSummary = {
  sectors: RoseSector[];
  calmFraction: number;
  sampleCount: number;
};

export function windRose(
  points: ReadonlyArray<HistoryPoint>,
  sectorCount = 16,
  options: { bandThresholdsMps?: ReadonlyArray<number> } = {},
): WindRoseSummary {
  const sectorWidth = 360 / sectorCount;
  const bounds = options.bandThresholdsMps ?? null;
  const sectors = Array.from({ length: sectorCount }, (_, index) => ({
    bearingDeg: index * sectorWidth,
    speeds: [] as number[],
    gusts: [] as number[],
    bandCounts: bounds == null ? null : Array.from({ length: bounds.length + 1 }, () => 0),
  }));
  let calm = 0;
  let counted = 0;
  for (const point of points) {
    counted += 1;
    if (isCalm(point.windAvgMps) || point.windDirectionDeg == null) {
      calm += 1;
      continue;
    }
    const index = Math.round(normalizeDegrees(point.windDirectionDeg) / sectorWidth) % sectorCount;
    const sector = sectors[index] as (typeof sectors)[number];
    sector.speeds.push(point.windAvgMps);
    if (point.windGustMps != null) sector.gusts.push(point.windGustMps);
    if (bounds != null && sector.bandCounts != null) {
      const band = speedBand(point.windAvgMps, bounds);
      sector.bandCounts[band] = (sector.bandCounts[band] ?? 0) + 1;
    }
  }
  const blowing = counted - calm;
  return {
    sampleCount: counted,
    calmFraction: counted === 0 ? 0 : calm / counted,
    sectors: sectors.map((sector) => ({
      bearingDeg: sector.bearingDeg,
      count: sector.speeds.length,
      frequency: blowing === 0 ? 0 : sector.speeds.length / blowing,
      meanSpeedMps:
        sector.speeds.length === 0
          ? null
          : sector.speeds.reduce((sum, speed) => sum + speed, 0) / sector.speeds.length,
      maxGustMps: sector.gusts.length === 0 ? null : Math.max(...sector.gusts),
      ...(sector.bandCounts == null ? {} : { bandCounts: sector.bandCounts }),
    })),
  };
}

export const DAILY_PATTERN_DEFAULT_SLOT_MINUTES = 180;

export type DailyPatternSlot = {
  startMinuteOfDay: number;
  sampleCount: number;
  windDirectionDeg: number | null;
  speedMps: number;
};

export function dailyPattern(
  points: ReadonlyArray<HistoryPoint>,
  options: { slotMinutes?: number; utcOffsetMinutes?: number } = {},
): DailyPatternSlot[] {
  const slotMinutes = options.slotMinutes ?? DAILY_PATTERN_DEFAULT_SLOT_MINUTES;
  if (slotMinutes <= 0 || 1440 % slotMinutes !== 0) {
    throw new Error(`dailyPattern: slotMinutes must evenly divide 1440, got ${slotMinutes}`);
  }
  const utcOffsetMinutes = options.utcOffsetMinutes ?? 0;
  const slotCount = 1440 / slotMinutes;
  const buckets: HistoryPoint[][] = Array.from({ length: slotCount }, () => []);
  for (const point of points) {
    const minuteOfDay = floorMod(
      Math.floor(Date.parse(point.observedAt) / 60_000) + utcOffsetMinutes,
      1440,
    );
    (buckets[Math.floor(minuteOfDay / slotMinutes)] as HistoryPoint[]).push(point);
  }
  return buckets.map((bucket, index) => ({
    startMinuteOfDay: index * slotMinutes,
    sampleCount: bucket.length,
    ...vectorMeanWind(bucket),
  }));
}

function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export const METEOROLOGICAL_SEASON_MONTHS: Record<
  "fall" | "spring" | "summer" | "winter",
  number[]
> = {
  winter: [12, 1, 2],
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  fall: [9, 10, 11],
};

export function filterByMonth(
  points: ReadonlyArray<HistoryPoint>,
  months: ReadonlyArray<number>,
  utcOffsetMinutes = 0,
): HistoryPoint[] {
  const wanted = new Set(months);
  return points.filter((point) => wanted.has(localMonth(point.observedAt, utcOffsetMinutes)));
}

function localMonth(observedAt: string, utcOffsetMinutes: number): number {
  return new Date(Date.parse(observedAt) + utcOffsetMinutes * 60_000).getUTCMonth() + 1;
}

export function filterByTimeOfDay(
  points: ReadonlyArray<HistoryPoint>,
  fromMinute: number,
  toMinute: number,
  utcOffsetMinutes = 0,
): HistoryPoint[] {
  const wraps = fromMinute > toMinute;
  return points.filter((point) => {
    const minute = floorMod(
      Math.floor(Date.parse(point.observedAt) / 60_000) + utcOffsetMinutes,
      1440,
    );
    return wraps
      ? minute >= fromMinute || minute < toMinute
      : minute >= fromMinute && minute < toMinute;
  });
}

/** The share of non-calm history blowing from inside the consumer's arcs;
 * null when nothing non-calm was measured. */
export function favorableShare(
  points: ReadonlyArray<HistoryPoint>,
  arcs: ReadonlyArray<DirectionArc>,
): number | null {
  let blowing = 0;
  let favorable = 0;
  for (const point of points) {
    if (isCalm(point.windAvgMps) || point.windDirectionDeg == null) continue;
    blowing += 1;
    if (inDirectionArcs(point.windDirectionDeg, arcs)) favorable += 1;
  }
  return blowing === 0 ? null : favorable / blowing;
}

export type HistoryCoverage = {
  actualCount: number;
  expectedCount: number;
  ratio: number;
};

/** Coverage of a requested window: points held against the count the period
 * implies for [fromMs, toMs). Expected comes from the request, never from the
 * first-to-last point span, so leading and trailing dropouts lower the ratio
 * instead of hiding. */
export function historyCoverage(
  points: ReadonlyArray<HistoryPoint>,
  periodMinutes: number,
  fromMs: number,
  toMs: number,
): HistoryCoverage {
  const expectedCount = Math.max(0, Math.floor((toMs - fromMs) / (periodMinutes * 60_000)));
  let actualCount = 0;
  for (const point of points) {
    const observedMs = Date.parse(point.observedAt);
    if (observedMs >= fromMs && observedMs < toMs) actualCount += 1;
  }
  return {
    actualCount,
    expectedCount,
    ratio: expectedCount === 0 ? 0 : actualCount / expectedCount,
  };
}

export const HISTORY_GAP_TOLERANCE_FACTOR = 2.5;

export function historyGaps(
  history: History,
  toleranceFactor = HISTORY_GAP_TOLERANCE_FACTOR,
): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  const limit = history.periodMinutes * 60_000 * toleranceFactor;
  for (let index = 1; index < history.points.length; index += 1) {
    const previous = Date.parse((history.points[index - 1] as HistoryPoint).observedAt);
    const current = Date.parse((history.points[index] as HistoryPoint).observedAt);
    if (current - previous > limit) gaps.push([previous, current]);
  }
  return gaps;
}

export const CHART_WIDE_PLOT_HEIGHT = 160;
export const CHART_WIDE_PLOT_MIN_WIDTH = 520;

export function stretchFrame(frame: ChartFrame, plotHeight: number): ChartFrame {
  const delta = plotHeight - (frame.plotBottom - frame.plotTop);
  if (delta === 0) return frame;
  return {
    ...frame,
    height: frame.height + delta,
    labelRow: frame.labelRow + delta,
    plotBottom: frame.plotBottom + delta,
    vaneLabelRow: frame.vaneLabelRow + delta,
    vaneRow: frame.vaneRow + delta,
    valueRow: frame.valueRow + delta,
  };
}

export type TrendSeries = "temperature" | "pressure";

export function trendValueOf(point: HistoryPoint, series: TrendSeries): number | null {
  return series === "temperature" ? point.temperatureC : (point.seaLevelPressureHpa ?? null);
}

export function trendSeriesPad(series: TrendSeries): number {
  return series === "temperature" ? 1 : 2;
}

export type TrendRun = { startedAt: string; samples: Array<readonly [number, number]> };

export function trendRuns(
  points: ReadonlyArray<HistoryPoint>,
  series: TrendSeries,
  periodMinutes: number,
): TrendRun[] {
  const gapLimitMs = periodMinutes * 60_000 * HISTORY_GAP_TOLERANCE_FACTOR;
  const runs: TrendRun[] = [];
  let run: TrendRun | null = null;
  let previousMs = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const value = trendValueOf(point, series);
    const ms = Date.parse(point.observedAt);
    if ((value == null || ms - previousMs > gapLimitMs) && run != null) {
      runs.push(run);
      run = null;
    }
    if (value != null) {
      run ??= { startedAt: point.observedAt, samples: [] };
      run.samples.push([ms, value] as const);
    }
    previousMs = ms;
  }
  if (run != null) runs.push(run);
  return runs;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function windowPoints(
  points: ReadonlyArray<HistoryPoint>,
  hours?: number,
): ReadonlyArray<HistoryPoint> {
  if (hours == null || points.length === 0) return points;
  const lastMs = Date.parse((points[points.length - 1] as HistoryPoint).observedAt);
  const cutoffMs = lastMs - hours * HOUR_MS;
  return points.filter((point) => Date.parse(point.observedAt) >= cutoffMs);
}

export function compareWindow(
  points: ReadonlyArray<HistoryPoint>,
  offsetDays: number,
  windowHours?: number,
): HistoryPoint[] | null {
  const displayed = windowPoints(points, windowHours);
  if (displayed.length === 0) return null;
  const shiftMs = offsetDays * DAY_MS;
  const startMs = Date.parse((displayed[0] as HistoryPoint).observedAt) - shiftMs;
  const endMs = Date.parse((displayed[displayed.length - 1] as HistoryPoint).observedAt) - shiftMs;
  const window = points.filter((point) => {
    const ms = Date.parse(point.observedAt);
    return ms >= startMs && ms <= endMs;
  });
  if (window.length === 0) return null;
  const firstMs = Date.parse((points[0] as HistoryPoint).observedAt);
  const lastMs = Date.parse((points[points.length - 1] as HistoryPoint).observedAt);
  const averagePeriodMs = points.length > 1 ? (lastMs - firstMs) / (points.length - 1) : 0;
  const tolerance = averagePeriodMs * HISTORY_GAP_TOLERANCE_FACTOR;
  const matchedStartMs = Date.parse((window[0] as HistoryPoint).observedAt);
  const matchedEndMs = Date.parse((window[window.length - 1] as HistoryPoint).observedAt);
  if (matchedStartMs - startMs > tolerance || endMs - matchedEndMs > tolerance) return null;
  return window;
}

export function compareTracePoints(
  comparePoints: ReadonlyArray<HistoryPoint>,
  scales: ChartScales,
  offsetDays: number,
): string {
  const shiftMs = offsetDays * DAY_MS;
  return comparePoints
    .map((point) =>
      coordinate(
        scales.xAtMs(Date.parse(point.observedAt) + shiftMs),
        scales.yAt(point.windAvgMps),
      ),
    )
    .join(" ");
}
