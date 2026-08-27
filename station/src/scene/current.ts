import type { Station } from "../contract.js";
import { compassDirection, isCalm } from "../derive.js";
import type { FreshnessStatus, SpeedThresholds, SpeedUnit } from "../derive.js";
import { roundSpeed, temperatureText, temperatureValue } from "../format.js";
import { DIAL_SIZE } from "../instruments.js";
import type { FavorableDirection } from "../instruments.js";
import { EM_DASH } from "../strings.js";
import type { FormatTime, StationStrings } from "../strings.js";
import { dialScene } from "./dial.js";
import { freshnessBadgeNode, windArrowNode } from "./glyphs.js";
import { el, type SceneChild, type SceneNode } from "./node.js";

export function currentConditionsScene(input: {
  bezelId: string;
  favorableDirections?: FavorableDirection[] | undefined;
  formatTime: FormatTime;
  freshness: FreshnessStatus | null;
  station: Station;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}): SceneNode {
  const { bezelId, favorableDirections, formatTime, freshness, station, thresholds, unit, words } =
    input;
  const reading = station.status === "ok" ? station.reading : null;
  const calm = reading != null && isCalm(reading.windAvgMps);
  const blowing = reading != null && !calm && reading.windDirectionDeg != null;

  const flank = (attrs: { class: string }, label: string, valueMps: number | null | undefined) =>
    el(
      "div",
      attrs,
      el("small", { class: "meteo-microlabel" }, label),
      el("strong", undefined, valueMps == null ? EM_DASH : String(roundSpeed(valueMps, unit))),
    );

  const directionChildren: SceneChild[] =
    station.status === "unavailable"
      ? [words.reasons[station.reason]]
      : blowing && reading.windDirectionDeg != null
        ? [
            el("span", { class: "meteo-current-from-label" }, words.fromLabel),
            " ",
            windArrowNode(reading.windDirectionDeg),
            " ",
            el("strong", undefined, compassDirection(reading.windDirectionDeg)),
            ` ${Math.round(reading.windDirectionDeg)}°`,
          ]
        : [calm ? words.calm : EM_DASH];

  return el(
    "div",
    {
      "aria-label": words.aria.current(station.name),
      class: "meteo-current",
      "data-status": station.status,
      role: "group",
    },
    el(
      "div",
      { class: "meteo-current-instrument" },
      station.capabilities.gustLull
        ? flank(
            { class: "meteo-current-flank meteo-current-flank-lull" },
            words.lullLabel,
            reading?.windLullMps,
          )
        : null,
      dialScene({
        bezelId,
        calmWord: false,
        favorableDirections,
        size: DIAL_SIZE,
        station,
        thresholds,
        unit,
        words,
      }),
      station.capabilities.gustLull
        ? flank(
            { class: "meteo-current-flank meteo-current-flank-gust" },
            words.gustLabel,
            reading?.windGustMps,
          )
        : null,
    ),
    el("p", { class: "meteo-current-direction" }, directionChildren),
    station.capabilities.temperature
      ? el(
          "p",
          { class: "meteo-current-temp" },
          temperatureText(reading?.temperatureC ?? null, words),
          reading?.windChillC != null
            ? el(
                "span",
                { class: "meteo-current-chill" },
                ` · ${words.feelsLikeLabel} ${temperatureValue(reading.windChillC)} ${words.degC}`,
              )
            : null,
        )
      : null,
    el(
      "p",
      { class: "meteo-current-footer" },
      freshness != null ? freshnessBadgeNode(freshness, words) : null,
      el(
        "span",
        { class: "meteo-current-observed" },
        reading == null ? EM_DASH : formatTime(new Date(reading.observedAt)),
      ),
    ),
  );
}
