import type { Station } from "../contract.js";
import type { SpeedUnit } from "../derive.js";
import { optionalSpeed, roundSpeed, temperatureText } from "../format.js";
import type { FormatTime, StationStrings } from "../strings.js";

export type StripLabelledCell = {
  className: string;
  labelClassName: string;
  label: string;
  value: string;
};

export type StripScene = {
  root: { ariaLabel: string; className: string; status: Station["status"] };
  stationClassName: string;
  body:
    | { kind: "reason"; className: string; text: string }
    | {
        kind: "reading";
        wind: { className: string; value: string; unitLabel: string };
        gustLull: { lull: StripLabelledCell; gust: StripLabelledCell } | null;
        from: { className: string; windAvgMps: number; windDirectionDeg: number | null };
        temperature: { className: string; text: string } | null;
        updated: { className: string; time: { className: string; text: string } };
      };
};

export function stationStripScene(input: {
  formatTime: FormatTime;
  station: Station;
  unit: SpeedUnit;
  words: StationStrings;
}): StripScene {
  const { formatTime, station, unit, words } = input;
  const root = {
    ariaLabel: words.aria.strip(station.name),
    className: "meteo-strip",
    status: station.status,
  };
  if (station.status !== "ok") {
    return {
      root,
      stationClassName: "meteo-strip-station",
      body: {
        kind: "reason",
        className: "meteo-strip-reason",
        text: words.reasons[station.reason],
      },
    };
  }
  return {
    root,
    stationClassName: "meteo-strip-station",
    body: {
      kind: "reading",
      wind: {
        className: "meteo-strip-wind",
        value: String(roundSpeed(station.reading.windAvgMps, unit)),
        unitLabel: words.speedUnits[unit],
      },
      gustLull: station.capabilities.gustLull
        ? {
            lull: {
              className: "meteo-strip-lull",
              labelClassName: "meteo-microlabel",
              label: words.lullLabel,
              value: optionalSpeed(station.reading.windLullMps, unit),
            },
            gust: {
              className: "meteo-strip-gust",
              labelClassName: "meteo-microlabel",
              label: words.gustLabel,
              value: optionalSpeed(station.reading.windGustMps, unit),
            },
          }
        : null,
      from: {
        className: "meteo-strip-from",
        windAvgMps: station.reading.windAvgMps,
        windDirectionDeg: station.reading.windDirectionDeg,
      },
      temperature: station.capabilities.temperature
        ? {
            className: "meteo-strip-temp",
            text: temperatureText(station.reading.temperatureC, words),
          }
        : null,
      updated: {
        className: "meteo-strip-updated",
        time: {
          className: "meteo-strip-time",
          text: formatTime(new Date(station.reading.observedAt)),
        },
      },
    },
  };
}
