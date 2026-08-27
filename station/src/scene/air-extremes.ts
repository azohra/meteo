import type { Station } from "../contract.js";
import { lastNightLowC, pressureDeltaHpa } from "../derive.js";
import { temperatureValue } from "../format.js";
import type { StationStrings } from "../strings.js";
import { el, keyed, type SceneNode } from "./node.js";

export const AIR_EXTREMES_CLASS = "meteo-air-extremes";

const PRESSURE_DELTA_WINDOW_HOURS = 3;

/** Null without served history — the tiles are functions of it; each tile
 * additionally stays absent when its own inputs are (no coordinates, no
 * night; no carried pressure, no delta). */
export function airExtremesScene(input: {
  nowMs: number;
  station: Station | undefined;
  words: StationStrings;
}): SceneNode | null {
  const { nowMs, station, words } = input;
  if (station == null || station.status !== "ok" || station.history == null) return null;

  const points = station.history.points;
  const tile = (key: string, label: string, value: string) =>
    keyed(
      key,
      "div",
      { class: "meteo-air-extremes-tile" },
      el("dt", { class: "meteo-microlabel" }, label),
      el("dd", { class: "meteo-air-extremes-value" }, value),
    );

  const tiles: SceneNode[] = [];
  const night = lastNightLowC(points, station.latitude, station.longitude, nowMs);
  if (night != null) {
    tiles.push(
      tile(
        "last-night-low",
        words.lastNightLowLabel,
        `${temperatureValue(night.lowC)} ${words.degC}`,
      ),
    );
  }

  const delta = pressureDeltaHpa(points, { windowHours: PRESSURE_DELTA_WINDOW_HOURS });
  if (delta != null) {
    tiles.push(
      tile(
        "pressure-delta",
        words.pressureDeltaLabel(PRESSURE_DELTA_WINDOW_HOURS),
        `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} ${words.air.unitHpa}`,
      ),
    );
  }

  if (tiles.length === 0) return null;
  return el(
    "dl",
    { "aria-label": words.aria.airExtremes(station.name), class: AIR_EXTREMES_CLASS },
    tiles,
  );
}
