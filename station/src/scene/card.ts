import type { Station } from "../contract.js";
import type { FreshnessStatus, SpeedThresholds, SpeedUnit } from "../derive.js";
import { summaryEntries } from "../format.js";
import type { FormatTime, StationStrings } from "../strings.js";
import { freshnessBadgeNode } from "./glyphs.js";
import { el, keyed, type SceneNode } from "./node.js";

export const STATION_CARD_CLASS = "meteo-station-card";

export function cardPartThresholds(
  own: SpeedThresholds | null | undefined,
  card: SpeedThresholds | undefined,
): SpeedThresholds | null {
  return (own === undefined ? card : (own ?? undefined)) ?? null;
}

export function cardPartWiringError(part: string, provider: string): string {
  return `${part} must render inside ${provider} — the provider carries the station, clocks, and display settings.`;
}

export function cardHeaderNode(
  station: Station,
  freshness: FreshnessStatus | null,
  words: StationStrings,
): SceneNode {
  return el(
    "header",
    { class: "meteo-station-card-header" },
    el(
      "div",
      { class: "meteo-station-card-identity" },
      el(
        "h3",
        { class: "meteo-station-card-name" },
        station.pageUrl == null
          ? station.name
          : el(
              "a",
              { href: station.pageUrl, rel: "noreferrer", target: "_blank" },
              `${station.name} \u2197`,
            ),
      ),
      el(
        "p",
        { class: "meteo-station-card-meta" },
        el("span", { class: "meteo-station-card-source" }, station.sourceLabel),
        station.elevationM == null
          ? null
          : el(
              "span",
              { class: "meteo-station-card-elevation" },
              ` \u00b7 ${words.elevation(Math.round(station.elevationM))}`,
            ),
      ),
    ),
    freshness != null ? freshnessBadgeNode(freshness, words) : null,
  );
}

export function summaryNode(
  station: Station,
  unit: SpeedUnit,
  words: StationStrings,
  formatTime: FormatTime,
): SceneNode | null {
  const summary = summaryEntries(station, unit, words, formatTime);
  if (summary == null) return null;
  return el(
    "dl",
    {
      "aria-label": words.aria.summary(formatTime(new Date(summary.periodEndedAt))),
      class: "meteo-summary",
    },
    summary.entries.map((entry) =>
      keyed(
        entry.label,
        "div",
        { class: "meteo-summary-item" },
        el("dt", { class: "meteo-microlabel" }, entry.label),
        el("dd", undefined, entry.value),
      ),
    ),
  );
}
