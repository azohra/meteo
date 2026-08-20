import type { Station } from "./contract.js";
import { anchoredAgeMs, compassDirection, isCalm, periodSummary, speedFromMps } from "./derive.js";
import type { CompassPoint, SpeedUnit } from "./derive.js";
import { EM_DASH } from "./strings.js";
import type { FormatTime, StationStrings } from "./strings.js";

export function roundSpeed(mps: number, unit: SpeedUnit): number {
  return Math.round(speedFromMps(mps, unit));
}

export function optionalSpeed(mps: number | null, unit: SpeedUnit): string {
  return mps == null ? EM_DASH : String(roundSpeed(mps, unit));
}

export function temperatureValue(temperatureC: number): string {
  return temperatureC.toFixed(1);
}

export function temperatureText(temperatureC: number | null, words: StationStrings): string {
  return temperatureC == null ? EM_DASH : `${temperatureValue(temperatureC)} ${words.degC}`;
}

export type SpeedKind = "average" | "gust" | "lull";

export function speedMpsOf(station: Station, kind: SpeedKind): number | null {
  if (station.status !== "ok") return null;
  switch (kind) {
    case "average":
      return station.reading.windAvgMps;
    case "gust":
      return station.capabilities.gustLull ? station.reading.windGustMps : null;
    case "lull":
      return station.capabilities.gustLull ? station.reading.windLullMps : null;
  }
}

export type DirectionCellData =
  | { kind: "calm" }
  | { kind: "dash" }
  | { kind: "bearing"; deg: number; compass: CompassPoint; rounded: number };

export function directionCell(
  windAvgMps: number,
  windDirectionDeg: number | null,
): DirectionCellData {
  if (isCalm(windAvgMps)) return { kind: "calm" };
  if (windDirectionDeg == null) return { kind: "dash" };
  return {
    kind: "bearing",
    deg: windDirectionDeg,
    compass: compassDirection(windDirectionDeg),
    rounded: Math.round(windDirectionDeg),
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
export const UPDATED_ABSOLUTE_AFTER_MS = 6 * HOUR_MS;

export function relativeWords(ageMs: number, words: StationStrings): string {
  if (ageMs < MINUTE_MS) return words.updated.justNow;
  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 60) return words.updated.minutesAgo(minutes);
  return words.updated.hoursAgo(Math.floor(ageMs / HOUR_MS));
}

/* Anchored when the anchor exists; without one the client clock is the
 * only measure left — a different fact, kept here. */
export function readingAgeMs(args: {
  observedAt: string;
  servedAt: string | null;
  receivedAtMs: number | null;
  nowMs: number;
}): number {
  return args.servedAt != null && args.receivedAtMs != null
    ? anchoredAgeMs({
        observedAt: args.observedAt,
        servedAt: args.servedAt,
        receivedAtMs: args.receivedAtMs,
        nowMs: args.nowMs,
      })
    : Math.max(0, args.nowMs - Date.parse(args.observedAt));
}

export function updatedAtText(
  ageMs: number,
  observedAt: string,
  words: StationStrings,
  formatTime: FormatTime,
): string {
  return ageMs >= UPDATED_ABSOLUTE_AFTER_MS
    ? formatTime(new Date(Date.parse(observedAt)))
    : relativeWords(ageMs, words);
}

export type SummaryEntry = { label: string; value: string };

export function summaryEntries(
  station: Station,
  unit: SpeedUnit,
  words: StationStrings,
  formatTime: FormatTime,
): { entries: SummaryEntry[]; periodEndedAt: string } | null {
  const history = station.status === "ok" ? station.history : null;
  const summary = history == null || history.points.length === 0 ? null : periodSummary(history);
  if (summary == null) return null;

  const capabilities = station.capabilities;
  const shown = (windAvgMps: number) => roundSpeed(windAvgMps, unit);
  const unitLabel = words.speedUnits[unit];
  const entries: SummaryEntry[] = [
    { label: words.averageLabel, value: `${shown(summary.windAvgMps)} ${unitLabel}` },
    ...(capabilities.gustLull
      ? [
          {
            label: words.peakLabel,
            value:
              summary.peakGustMps == null
                ? EM_DASH
                : `${shown(summary.peakGustMps)} ${unitLabel}${
                    summary.peakGustAt == null
                      ? ""
                      : ` · ${formatTime(new Date(summary.peakGustAt))}`
                  }`,
          },
          {
            label: words.minLabel,
            value:
              summary.lowestLullMps == null
                ? EM_DASH
                : `${shown(summary.lowestLullMps)} ${unitLabel}`,
          },
        ]
      : []),
    { label: words.windRunLabel, value: `${Math.round(summary.windRunKm)} ${words.km}` },
    ...(capabilities.temperature
      ? [
          {
            label: words.tempRangeLabel,
            value:
              summary.temperatureLowC == null || summary.temperatureHighC == null
                ? EM_DASH
                : `${summary.temperatureLowC.toFixed(1)}–${summary.temperatureHighC.toFixed(1)} ${words.degC}`,
          },
        ]
      : []),
  ];

  return { entries, periodEndedAt: summary.periodEndedAt };
}
