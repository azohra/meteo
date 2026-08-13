import type { Station } from "../contract.js";
import { compassDirection, isCalm, thresholdsToMps } from "../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import {
  readingAgeMs,
  roundSpeed,
  speedMpsOf,
  temperatureValue,
  updatedAtText,
} from "../format.js";
import type { SpeedKind } from "../format.js";
import { speedBand } from "../geometry.js";
import { EM_DASH } from "../strings.js";
import type { FormatTime, StationStrings } from "../strings.js";

export type ValueAtomScene = {
  className: string;
  value: number | undefined;
  content:
    | { kind: "dash"; text: string }
    | { kind: "value"; text: string; unit: { className: string; text: string } };
};

const valueContent = (
  value: number | null,
  shown: (value: number) => string,
  unitWord: string,
): ValueAtomScene["content"] =>
  value == null
    ? { kind: "dash", text: EM_DASH }
    : {
        kind: "value",
        text: `${shown(value)} `,
        unit: { className: "meteo-unit", text: unitWord },
      };

export function speedAtomScene(
  station: Station,
  kind: SpeedKind,
  unit: SpeedUnit,
  words: StationStrings,
): ValueAtomScene {
  const mps = speedMpsOf(station, kind);
  return {
    className: "meteo-value meteo-speed",
    value: mps ?? undefined,
    content: valueContent(mps, (value) => String(roundSpeed(value, unit)), words.speedUnits[unit]),
  };
}

export function temperatureAtomScene(station: Station, words: StationStrings): ValueAtomScene {
  const celsius =
    station.status === "ok" && station.capabilities.temperature
      ? station.reading.temperatureC
      : null;
  return {
    className: "meteo-value meteo-temperature",
    value: celsius ?? undefined,
    content: valueContent(celsius, temperatureValue, words.degC),
  };
}

export function pressureAtomScene(station: Station, words: StationStrings): ValueAtomScene {
  const hpa =
    station.status === "ok" && station.capabilities.conditions
      ? (station.reading.conditions?.seaLevelPressureHpa ?? null)
      : null;
  return {
    className: "meteo-value meteo-pressure",
    value: hpa ?? undefined,
    content: valueContent(hpa, (value) => value.toFixed(1), words.air.unitHpa),
  };
}

export type DirectionAtomScene = {
  className: string;
  ariaLabel: string | undefined;
  cell: { windAvgMps: number; windDirectionDeg: number | null } | null;
  dashText: string;
};

export function directionAtomScene(station: Station, words: StationStrings): DirectionAtomScene {
  const reading = station.status === "ok" ? station.reading : null;
  if (reading == null) {
    return { className: "meteo-direction", ariaLabel: undefined, cell: null, dashText: EM_DASH };
  }
  const bearingDeg = isCalm(reading.windAvgMps) ? null : reading.windDirectionDeg;
  const point = bearingDeg == null ? null : compassDirection(bearingDeg);
  return {
    className: "meteo-direction",
    ariaLabel:
      point == null || bearingDeg == null
        ? undefined
        : words.aria.direction(words.compassSpoken[point], Math.round(bearingDeg)),
    cell: { windAvgMps: reading.windAvgMps, windDirectionDeg: reading.windDirectionDeg },
    dashText: EM_DASH,
  };
}

export type UpdatedAtScene =
  | { kind: "dash"; className: string; text: string }
  | { kind: "time"; className: string; dateTime: string; text: string };

export function updatedAtScene(input: {
  formatTime: FormatTime;
  nowMs: number;
  receivedAtMs: number | null;
  servedAt: string | null;
  station: Station;
  words: StationStrings;
}): UpdatedAtScene {
  const { formatTime, nowMs, receivedAtMs, servedAt, station, words } = input;
  const reading = station.status === "ok" ? station.reading : null;
  if (reading == null) {
    return { kind: "dash", className: "meteo-updated", text: EM_DASH };
  }
  const ageMs = readingAgeMs({ observedAt: reading.observedAt, servedAt, receivedAtMs, nowMs });
  return {
    kind: "time",
    className: "meteo-updated",
    dateTime: reading.observedAt,
    text: updatedAtText(ageMs, reading.observedAt, words, formatTime),
  };
}

export type BandChipScene = {
  className: string;
  band: number | undefined;
  text: string;
};

export function bandChipScene(input: {
  labels: readonly string[] | undefined;
  station: Station;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}): BandChipScene {
  const { labels, station, thresholds, unit, words } = input;
  const reading = station.status === "ok" ? station.reading : null;
  if (reading != null && isCalm(reading.windAvgMps)) {
    return { className: "meteo-band-chip", band: undefined, text: words.calm };
  }
  if (reading == null || thresholds == null) {
    return { className: "meteo-band-chip", band: undefined, text: EM_DASH };
  }
  const band = speedBand(reading.windAvgMps, thresholdsToMps(thresholds));
  return {
    className: "meteo-band-chip",
    band,
    text: labels?.[band] ?? `${roundSpeed(reading.windAvgMps, unit)} ${words.speedUnits[unit]}`,
  };
}
