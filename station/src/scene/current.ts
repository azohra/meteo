import type { Station } from "../contract.js";
import { compassDirection, isCalm } from "../derive.js";
import type { SpeedUnit } from "../derive.js";
import { roundSpeed, temperatureText, temperatureValue } from "../format.js";
import { EM_DASH } from "../strings.js";
import type { FormatTime, StationStrings } from "../strings.js";

export type CurrentFlank = {
  className: string;
  labelClassName: string;
  label: string;
  value: string;
};

export type CurrentConditionsScene = {
  root: { ariaLabel: string; className: string; status: Station["status"] };
  instrumentClassName: string;
  flanks: { lull: CurrentFlank; gust: CurrentFlank } | null;
  direction: {
    className: string;
    content:
      | { kind: "text"; text: string }
      | {
          kind: "from";
          labelClassName: string;
          label: string;
          deg: number;
          compass: string;
          tail: string;
        };
  };
  temperature: {
    className: string;
    text: string;
    chill: { className: string; text: string } | null;
  } | null;
  footer: { className: string; observed: { className: string; text: string } };
};

export function currentConditionsScene(input: {
  formatTime: FormatTime;
  station: Station;
  unit: SpeedUnit;
  words: StationStrings;
}): CurrentConditionsScene {
  const { formatTime, station, unit, words } = input;
  const reading = station.status === "ok" ? station.reading : null;
  const calm = reading != null && isCalm(reading.windAvgMps);
  const blowing = reading != null && !calm && reading.windDirectionDeg != null;

  const flankValue = (valueMps: number | null | undefined): string =>
    valueMps == null ? EM_DASH : String(roundSpeed(valueMps, unit));

  return {
    root: {
      ariaLabel: words.aria.current(station.name),
      className: "meteo-current",
      status: station.status,
    },
    instrumentClassName: "meteo-current-instrument",
    flanks: station.capabilities.gustLull
      ? {
          lull: {
            className: "meteo-current-flank meteo-current-flank-lull",
            labelClassName: "meteo-microlabel",
            label: words.lullLabel,
            value: flankValue(reading?.windLullMps),
          },
          gust: {
            className: "meteo-current-flank meteo-current-flank-gust",
            labelClassName: "meteo-microlabel",
            label: words.gustLabel,
            value: flankValue(reading?.windGustMps),
          },
        }
      : null,
    direction: {
      className: "meteo-current-direction",
      content:
        station.status === "unavailable"
          ? { kind: "text", text: words.reasons[station.reason] }
          : blowing && reading.windDirectionDeg != null
            ? {
                kind: "from",
                labelClassName: "meteo-current-from-label",
                label: words.fromLabel,
                deg: reading.windDirectionDeg,
                compass: compassDirection(reading.windDirectionDeg),
                tail: ` ${Math.round(reading.windDirectionDeg)}°`,
              }
            : { kind: "text", text: calm ? words.calm : EM_DASH },
    },
    temperature: station.capabilities.temperature
      ? {
          className: "meteo-current-temp",
          text: temperatureText(reading?.temperatureC ?? null, words),
          chill:
            reading?.windChillC != null
              ? {
                  className: "meteo-current-chill",
                  text: ` · ${words.feelsLikeLabel} ${temperatureValue(reading.windChillC)} ${words.degC}`,
                }
              : null,
        }
      : null,
    footer: {
      className: "meteo-current-footer",
      observed: {
        className: "meteo-current-observed",
        text: reading == null ? EM_DASH : formatTime(new Date(reading.observedAt)),
      },
    },
  };
}
