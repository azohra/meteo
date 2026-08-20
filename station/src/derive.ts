import type { History, HistoryPoint, StationMeta } from "./contract.js";
import {
  KMH_PER_MPS,
  degreesToRadians,
  normalizeDegrees,
  radiansToDegrees,
  solarEventsForDate,
} from "@azohra/meteo.core";

export { KMH_PER_MPS };

export const CALM_THRESHOLD_MPS = 0.5;

export function isCalm(speedMps: number): boolean {
  return speedMps < CALM_THRESHOLD_MPS;
}

export const SPEED_UNITS = ["kmh", "knots", "mph", "mps"] as const;
export type SpeedUnit = (typeof SPEED_UNITS)[number];

const KNOTS_PER_MPS = 1 / 0.514444;
const MPH_PER_MPS = 1 / 0.44704;

function unitsPerMps(unit: SpeedUnit): number {
  switch (unit) {
    case "kmh":
      return KMH_PER_MPS;
    case "knots":
      return KNOTS_PER_MPS;
    case "mph":
      return MPH_PER_MPS;
    case "mps":
      return 1;
  }
}

export function speedFromMps(mps: number, unit: SpeedUnit): number {
  return mps * unitsPerMps(unit);
}

export function speedToMps(value: number, unit: SpeedUnit): number {
  return value / unitsPerMps(unit);
}

export type SpeedThresholds = {
  unit: SpeedUnit;
  values: readonly number[];
};

export function thresholdsToMps(thresholds: SpeedThresholds): number[] {
  return thresholds.values.map((value) => speedToMps(value, thresholds.unit));
}

export function speedUnitLabel(unit: SpeedUnit): string {
  switch (unit) {
    case "kmh":
      return "km/h";
    case "knots":
      return "kn";
    case "mph":
      return "mph";
    case "mps":
      return "m/s";
  }
}

export { normalizeDegrees };

export function radians(value: number): number {
  return degreesToRadians(value);
}

export function degrees(radianValue: number): number {
  return radiansToDegrees(radianValue);
}

export const COMPASS_POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

export function compassDirection(bearingDeg: number): CompassPoint {
  const normalized = normalizeDegrees(bearingDeg);
  return COMPASS_POINTS[Math.round(normalized / 22.5) % COMPASS_POINTS.length] as CompassPoint;
}

export type PeriodSummary = {
  windAvgMps: number;
  peakGustMps: number | null;
  peakGustAt: string | null;
  lowestLullMps: number | null;
  periodEndedAt: string;
  temperatureHighC: number | null;
  temperatureHighAt: string | null;
  temperatureLowC: number | null;
  temperatureLowAt: string | null;
  windRunKm: number;
};

export function periodSummary(history: History): PeriodSummary | null {
  const points = history.points;
  const last = points[points.length - 1];
  if (!last) return null;
  const speedSum = points.reduce((total, point) => total + point.windAvgMps, 0);

  let peak: HistoryPoint | null = null;
  let lowestLullMps: number | null = null;
  let high: HistoryPoint | null = null;
  let low: HistoryPoint | null = null;
  for (const point of points) {
    if (
      point.windGustMps != null &&
      (peak == null || point.windGustMps > (peak.windGustMps as number))
    ) {
      peak = point;
    }
    if (point.windLullMps != null) {
      lowestLullMps =
        lowestLullMps == null ? point.windLullMps : Math.min(lowestLullMps, point.windLullMps);
    }
    if (point.temperatureC != null) {
      if (high == null || point.temperatureC > (high.temperatureC as number)) high = point;
      if (low == null || point.temperatureC < (low.temperatureC as number)) low = point;
    }
  }

  return {
    windAvgMps: speedSum / points.length,
    peakGustMps: peak?.windGustMps ?? null,
    peakGustAt: peak?.observedAt ?? null,
    lowestLullMps,
    periodEndedAt: last.observedAt,
    temperatureHighC: high?.temperatureC ?? null,
    temperatureHighAt: high?.observedAt ?? null,
    temperatureLowC: low?.temperatureC ?? null,
    temperatureLowAt: low?.observedAt ?? null,
    windRunKm: (speedSum * history.periodMinutes * 60) / 1000,
  };
}

export function seaLevelPressureHpa(
  stationPressureHpa: number,
  elevationM: number,
  temperatureC: number | null = 15,
): number {
  const temperature = temperatureC ?? 15;
  const factor = 1 - (0.0065 * elevationM) / (temperature + 0.0065 * elevationM + 273.15);
  return stationPressureHpa * Math.pow(factor, -5.257);
}

export type PressureTendency = "falling" | "rising" | "steady";

/** The signed sea-level pressure change over the trailing window, hPa —
 * the number behind the tendency word. The reference is the carried point
 * nearest the window's start, and a record covering under 60% of the
 * window returns null rather than a delta over a shorter span. */
export function pressureDeltaHpa(
  points: ReadonlyArray<{ observedAt: string; seaLevelPressureHpa?: number | null }>,
  { windowHours = 3 }: { windowHours?: number } = {},
): number | null {
  const carrying = points.filter((point) => point.seaLevelPressureHpa != null);
  const last = carrying[carrying.length - 1];
  if (!last) return null;
  const targetMs = Date.parse(last.observedAt) - windowHours * 3_600_000;
  let reference: (typeof carrying)[number] | null = null;
  for (const point of carrying) {
    if (
      reference == null ||
      Math.abs(Date.parse(point.observedAt) - targetMs) <
        Math.abs(Date.parse(reference.observedAt) - targetMs)
    ) {
      reference = point;
    }
  }
  if (
    reference == null ||
    Date.parse(last.observedAt) - Date.parse(reference.observedAt) < windowHours * 3_600_000 * 0.6
  ) {
    return null;
  }
  return (last.seaLevelPressureHpa as number) - (reference.seaLevelPressureHpa as number);
}

export function pressureTendency(
  points: ReadonlyArray<{ observedAt: string; seaLevelPressureHpa?: number | null }>,
  { windowHours = 3, thresholdHpa = 1.5 }: { windowHours?: number; thresholdHpa?: number } = {},
): PressureTendency | null {
  const delta = pressureDeltaHpa(points, { windowHours });
  if (delta == null) return null;
  if (delta >= thresholdHpa) return "rising";
  if (delta <= -thresholdHpa) return "falling";
  return "steady";
}

/** The lowest temperature of the most recent completed night — the previous
 * sunset to the latest sunrise, from real astronomy. Null without
 * coordinates (never a guessed night), under a polar sky, or when no
 * carried temperature falls inside the window. */
export function lastNightLowC(
  points: ReadonlyArray<{ observedAt: string; temperatureC?: number | null }>,
  latitude: number | null,
  longitude: number | null,
  nowMs: number,
): { lowC: number; fromMs: number; toMs: number } | null {
  if (latitude == null || longitude == null) return null;
  const dayMs = 86_400_000;
  const dateKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  /* Walk back to the latest sunrise already behind now, then pair it with
   * the sunset before it. */
  for (
    let dayStart = Math.floor(nowMs / dayMs) * dayMs;
    dayStart >= nowMs - 3 * dayMs;
    dayStart -= dayMs
  ) {
    const today = solarEventsForDate(dateKey(dayStart), latitude, longitude);
    if (today == null) return null;
    if (today.sunrise.getTime() > nowMs) continue;
    const yesterday = solarEventsForDate(dateKey(dayStart - dayMs), latitude, longitude);
    if (yesterday == null) return null;
    const fromMs = yesterday.sunset.getTime();
    const toMs = today.sunrise.getTime();
    let lowC: number | null = null;
    for (const point of points) {
      if (point.temperatureC == null) continue;
      const observedMs = Date.parse(point.observedAt);
      if (observedMs < fromMs || observedMs > toMs) continue;
      lowC = lowC == null ? point.temperatureC : Math.min(lowC, point.temperatureC);
    }
    return lowC == null ? null : { lowC, fromMs, toMs };
  }
  return null;
}

export type FreshnessStatus = "live" | "aging" | "stale";

export type FreshnessThresholds = {
  currentForMs: number;
  staleAfterMs: number;
};

export const DEFAULT_FRESHNESS_THRESHOLDS: FreshnessThresholds = {
  currentForMs: 10 * 60_000,
  staleAfterMs: 45 * 60_000,
};

const clampMs = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function stationFreshnessThresholds(
  meta: Pick<StationMeta, "recommendedPollSeconds">,
): FreshnessThresholds {
  const currentForMs = clampMs(meta.recommendedPollSeconds * 5 * 1_000, 60_000, 10 * 60_000);
  return {
    currentForMs,
    staleAfterMs: clampMs(currentForMs * 6, 10 * 60_000, 45 * 60_000),
  };
}

/* The contract's anchor rule: a reading's age is its age at serve time plus
 * the time since receipt, each clamped non-negative — the client's clock
 * offset never enters, so a wrong client clock cannot age a live station. */
export function anchoredAgeMs(input: {
  observedAt: string;
  servedAt: string;
  receivedAtMs: number;
  nowMs: number;
}): number {
  return (
    Math.max(0, Date.parse(input.servedAt) - Date.parse(input.observedAt)) +
    Math.max(0, input.nowMs - input.receivedAtMs)
  );
}

export function freshness(
  input: {
    observedAt: string;
    servedAt: string;
    receivedAtMs: number;
    nowMs: number;
  },
  thresholds: FreshnessThresholds = DEFAULT_FRESHNESS_THRESHOLDS,
): FreshnessStatus {
  const ageMs = anchoredAgeMs(input);
  if (ageMs <= thresholds.currentForMs) return "live";
  if (ageMs <= thresholds.staleAfterMs) return "aging";
  return "stale";
}
