import type { Station } from "../contract.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import { summaryEntries } from "../format.js";
import type { FormatTime, StationStrings } from "../strings.js";

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

export type CardHeaderScene = {
  className: string;
  identity: {
    className: string;
    name: {
      className: string;
      link: { href: string; rel: string; target: string; text: string } | null;
      text: string;
    };
    meta: {
      className: string;
      source: { className: string; text: string };
      elevation: { className: string; text: string } | null;
    };
  };
};

export function cardHeaderScene(station: Station, words: StationStrings): CardHeaderScene {
  return {
    className: "meteo-station-card-header",
    identity: {
      className: "meteo-station-card-identity",
      name: {
        className: "meteo-station-card-name",
        link:
          station.pageUrl == null
            ? null
            : {
                href: station.pageUrl,
                rel: "noreferrer",
                target: "_blank",
                text: `${station.name} ↗`,
              },
        text: station.name,
      },
      meta: {
        className: "meteo-station-card-meta",
        source: { className: "meteo-station-card-source", text: station.sourceLabel },
        elevation:
          station.elevationM == null
            ? null
            : {
                className: "meteo-station-card-elevation",
                text: ` · ${words.elevation(Math.round(station.elevationM))}`,
              },
      },
    },
  };
}

export type SummaryScene = {
  ariaLabel: string;
  className: string;
  itemClassName: string;
  labelClassName: string;
  items: Array<{ label: string; value: string }>;
};

export function summaryScene(
  station: Station,
  unit: SpeedUnit,
  words: StationStrings,
  formatTime: FormatTime,
): SummaryScene | null {
  const summary = summaryEntries(station, unit, words, formatTime);
  if (summary == null) return null;
  return {
    ariaLabel: words.aria.summary(formatTime(new Date(summary.periodEndedAt))),
    className: "meteo-summary",
    itemClassName: "meteo-summary-item",
    labelClassName: "meteo-microlabel",
    items: summary.entries.map((entry) => ({ label: entry.label, value: entry.value })),
  };
}
