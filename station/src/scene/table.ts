import type { Station } from "../contract.js";
import type { FreshnessStatus, SpeedUnit } from "../derive.js";
import { optionalSpeed, roundSpeed, temperatureText } from "../format.js";
import type { FormatTime, StationStrings } from "../strings.js";
import { directionCellNodes } from "./cells.js";
import { freshnessBadgeNode } from "./glyphs.js";
import { el, keyed, type SceneChild, type SceneNode } from "./node.js";

export const TABLE_ROW_CLASS = "meteo-station-table-row";
export const TABLE_STATION_CELL_CLASS = "meteo-station-table-station";

export function stationTableHeadNode(words: StationStrings): SceneNode {
  const columns = [
    words.table.station,
    words.table.wind,
    words.table.lull,
    words.table.gust,
    words.table.from,
    words.table.temp,
    words.table.updated,
  ];
  return el(
    "div",
    { class: `${TABLE_ROW_CLASS} meteo-station-table-head meteo-microlabel`, role: "row" },
    columns.map((column) => keyed(column, "span", { role: "columnheader" }, column)),
  );
}

/** Every cell after the station cell. The station cell stays with each
 * binding: its `stationMeta` slot is a published escape hatch whose type
 * differs by binding (a ReactNode there, a DOM node here). */
export function stationTableRowCells(input: {
  formatTime: FormatTime;
  freshness: FreshnessStatus | null;
  station: Station;
  unit: SpeedUnit;
  words: StationStrings;
}): SceneChild[] {
  const { formatTime, freshness, station, unit, words } = input;
  if (station.status !== "ok") {
    return [
      el(
        "span",
        { class: "meteo-station-table-reason", role: "cell" },
        words.reasons[station.reason],
      ),
    ];
  }
  const cell = (className: string, ...children: (SceneChild | SceneChild[])[]) =>
    el("span", { class: className, role: "cell" }, ...children);
  return [
    cell(
      "meteo-station-table-wind",
      el("strong", undefined, String(roundSpeed(station.reading.windAvgMps, unit))),
      el("small", undefined, words.speedUnits[unit]),
    ),
    cell("meteo-station-table-lull", optionalSpeed(station.reading.windLullMps, unit)),
    cell("meteo-station-table-gust", optionalSpeed(station.reading.windGustMps, unit)),
    cell(
      "meteo-station-table-from",
      directionCellNodes(station.reading.windAvgMps, station.reading.windDirectionDeg, words),
    ),
    cell("meteo-station-table-temp", temperatureText(station.reading.temperatureC, words)),
    cell(
      "meteo-station-table-updated",
      el(
        "span",
        { class: "meteo-station-table-time" },
        formatTime(new Date(station.reading.observedAt)),
      ),
      freshness != null ? freshnessBadgeNode(freshness, words) : null,
    ),
  ];
}

export function stationTableRootAttrs(
  stations: ReadonlyArray<Station>,
  words: StationStrings,
): Record<string, string> {
  return {
    "aria-label": words.aria.table(stations.length),
    class: "meteo-station-table",
    role: "table",
  };
}

export const TABLE_BODY_CLASS = "meteo-station-table-body";
