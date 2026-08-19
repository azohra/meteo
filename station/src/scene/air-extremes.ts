import type { Station } from "../contract.js";
import { lastNightLowC, pressureDeltaHpa } from "../derive.js";
import { temperatureValue } from "../format.js";
import type { StationStrings } from "../strings.js";

export const AIR_EXTREMES_CLASS = "meteo-air-extremes";

const PRESSURE_DELTA_WINDOW_HOURS = 3;

export type AirExtremesGate =
  | { kind: "draw"; station: Extract<Station, { status: "ok" }> }
  | { kind: "hidden" };

/** hidden without served history — the tiles are functions of it; each tile
 * additionally stays absent when its own inputs are (no coordinates, no
 * night; no carried pressure, no delta). */
export function airExtremesGate(station: Station | undefined): AirExtremesGate {
  if (station == null || station.status !== "ok" || station.history == null) {
    return { kind: "hidden" };
  }
  return { kind: "draw", station };
}

export type AirExtremesScene = {
  className: string;
  ariaLabel: string;
  tiles: Array<{ key: string; className: string; label: string; value: string }>;
} | null;

export function airExtremesScene(input: {
  nowMs: number;
  station: Extract<Station, { status: "ok" }>;
  words: StationStrings;
}): AirExtremesScene {
  const { nowMs, station, words } = input;
  const points = station.history?.points ?? [];
  const tiles: Array<{ key: string; className: string; label: string; value: string }> = [];

  const night = lastNightLowC(points, station.latitude, station.longitude, nowMs);
  if (night != null) {
    tiles.push({
      key: "last-night-low",
      className: "meteo-air-extremes-tile",
      label: words.lastNightLowLabel,
      value: `${temperatureValue(night.lowC)} ${words.degC}`,
    });
  }

  const delta = pressureDeltaHpa(points, { windowHours: PRESSURE_DELTA_WINDOW_HOURS });
  if (delta != null) {
    tiles.push({
      key: "pressure-delta",
      className: "meteo-air-extremes-tile",
      label: words.pressureDeltaLabel(PRESSURE_DELTA_WINDOW_HOURS),
      value: `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} ${words.air.unitHpa}`,
    });
  }

  if (tiles.length === 0) return null;
  return {
    className: AIR_EXTREMES_CLASS,
    ariaLabel: words.aria.airExtremes(station.name),
    tiles,
  };
}
