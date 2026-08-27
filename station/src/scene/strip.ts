import type { Station } from "../contract.js";
import type { FreshnessStatus, SpeedUnit } from "../derive.js";
import { optionalSpeed, roundSpeed, temperatureText } from "../format.js";
import type { FormatTime, StationStrings } from "../strings.js";
import { directionCellNodes, stationNameNode } from "./cells.js";
import { freshnessBadgeNode } from "./glyphs.js";
import { el, type SceneChild, type SceneNode } from "./node.js";

export function stationStripScene(input: {
  formatTime: FormatTime;
  freshness: FreshnessStatus | null;
  station: Station;
  unit: SpeedUnit;
  words: StationStrings;
}): SceneNode {
  const { formatTime, freshness, station, unit, words } = input;

  const labelled = (className: string, label: string, value: string) =>
    el("span", { class: className }, el("small", { class: "meteo-microlabel" }, label), value);

  const cells: SceneChild[] =
    station.status !== "ok"
      ? [el("span", { class: "meteo-strip-reason" }, words.reasons[station.reason])]
      : [
          el(
            "span",
            { class: "meteo-strip-wind" },
            el("strong", undefined, String(roundSpeed(station.reading.windAvgMps, unit))),
            el("small", undefined, words.speedUnits[unit]),
          ),
          ...(station.capabilities.gustLull
            ? [
                labelled(
                  "meteo-strip-lull",
                  words.lullLabel,
                  optionalSpeed(station.reading.windLullMps, unit),
                ),
                labelled(
                  "meteo-strip-gust",
                  words.gustLabel,
                  optionalSpeed(station.reading.windGustMps, unit),
                ),
              ]
            : []),
          el(
            "span",
            { class: "meteo-strip-from" },
            directionCellNodes(station.reading.windAvgMps, station.reading.windDirectionDeg, words),
          ),
          station.capabilities.temperature
            ? el(
                "span",
                { class: "meteo-strip-temp" },
                temperatureText(station.reading.temperatureC, words),
              )
            : null,
          el(
            "span",
            { class: "meteo-strip-updated" },
            el(
              "span",
              { class: "meteo-strip-time" },
              formatTime(new Date(station.reading.observedAt)),
            ),
            freshness != null ? freshnessBadgeNode(freshness, words) : null,
          ),
        ];

  return el(
    "div",
    {
      "aria-label": words.aria.strip(station.name),
      class: "meteo-strip",
      "data-status": station.status,
      role: "group",
    },
    el("span", { class: "meteo-strip-station" }, stationNameNode(station)),
    cells,
  );
}
