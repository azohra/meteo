import type { Station } from "../contract.js";
import type { SpeedUnit } from "../derive.js";
import { optionalSpeed, roundSpeed, temperatureText } from "../format.js";
import type { FormatTime, StationStrings } from "../strings.js";

export type StationTableScene = {
  root: { ariaLabel: string; className: string };
  head: { className: string; columns: string[] };
  bodyClassName: string;
};

export function stationTableScene(
  stations: ReadonlyArray<Station>,
  words: StationStrings,
): StationTableScene {
  return {
    root: { ariaLabel: words.aria.table(stations.length), className: "meteo-station-table" },
    head: {
      className: "meteo-station-table-row meteo-station-table-head meteo-microlabel",
      columns: [
        words.table.station,
        words.table.wind,
        words.table.lull,
        words.table.gust,
        words.table.from,
        words.table.temp,
        words.table.updated,
      ],
    },
    bodyClassName: "meteo-station-table-body",
  };
}

export type StationTableRowScene = {
  className: string;
  status: Station["status"];
  stationCellClassName: string;
  cells:
    | { kind: "reason"; className: string; text: string }
    | {
        kind: "reading";
        wind: { className: string; value: string; unitLabel: string };
        lull: { className: string; value: string };
        gust: { className: string; value: string };
        from: { className: string; windAvgMps: number; windDirectionDeg: number | null };
        temperature: { className: string; value: string };
        updated: { className: string; time: { className: string; text: string } };
      };
};

export function stationTableRowScene(input: {
  formatTime: FormatTime;
  station: Station;
  unit: SpeedUnit;
  words: StationStrings;
}): StationTableRowScene {
  const { formatTime, station, unit, words } = input;
  const base = {
    className: "meteo-station-table-row",
    status: station.status,
    stationCellClassName: "meteo-station-table-station",
  };
  if (station.status !== "ok") {
    return {
      ...base,
      cells: {
        kind: "reason",
        className: "meteo-station-table-reason",
        text: words.reasons[station.reason],
      },
    };
  }
  return {
    ...base,
    cells: {
      kind: "reading",
      wind: {
        className: "meteo-station-table-wind",
        value: String(roundSpeed(station.reading.windAvgMps, unit)),
        unitLabel: words.speedUnits[unit],
      },
      lull: {
        className: "meteo-station-table-lull",
        value: optionalSpeed(station.reading.windLullMps, unit),
      },
      gust: {
        className: "meteo-station-table-gust",
        value: optionalSpeed(station.reading.windGustMps, unit),
      },
      from: {
        className: "meteo-station-table-from",
        windAvgMps: station.reading.windAvgMps,
        windDirectionDeg: station.reading.windDirectionDeg,
      },
      temperature: {
        className: "meteo-station-table-temp",
        value: temperatureText(station.reading.temperatureC, words),
      },
      updated: {
        className: "meteo-station-table-updated",
        time: {
          className: "meteo-station-table-time",
          text: formatTime(new Date(station.reading.observedAt)),
        },
      },
    },
  };
}
