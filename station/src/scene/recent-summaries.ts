import { inDirectionArcs } from "@azohra/meteo.core";
import type { RecentSummary, Station } from "../contract.js";
import type { SpeedUnit } from "../derive.js";
import { optionalSpeed, roundSpeed } from "../format.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";

export const RECENT_SUMMARIES_CLASS = "meteo-recent-summaries";

export type RecentSummariesGate =
  | { kind: "draw"; summaries: RecentSummary[] }
  | { kind: "hidden" }
  | { kind: "note"; className: string; text: string };

/** hidden unless the source declares the capability; the no-samples words
 * when the declared block is dark. */
export function recentSummariesGate(
  station: Station | undefined,
  summaries: RecentSummary[] | null | undefined,
  words: StationStrings,
): RecentSummariesGate {
  const source = summaries ?? (station?.status === "ok" ? (station.recentSummaries ?? null) : null);
  if (station != null && station.capabilities.recentSummaries !== true) return { kind: "hidden" };
  if (source == null || source.length === 0) {
    return {
      kind: "note",
      className: `${RECENT_SUMMARIES_CLASS} meteo-recent-summaries-na`,
      text: words.noSamples,
    };
  }
  return { kind: "draw", summaries: source };
}

export type RecentSummaryPanel = {
  key: number;
  className: string;
  label: { className: string; text: string };
  stats: Array<{ key: string; className: string; label: string; value: string }>;
  /** One small arrow per filled step, oldest first; a calm step is absent. */
  ghosts: Array<{ key: string; className: string; deg: number }>;
};

export type RecentSummariesScene = {
  className: string;
  ariaLabel: string;
  panels: RecentSummaryPanel[];
};

export function recentSummariesScene(input: {
  favorableDirections: FavorableDirection[] | undefined;
  stationName: string | undefined;
  summaries: RecentSummary[];
  unit: SpeedUnit;
  words: StationStrings;
}): RecentSummariesScene {
  const { favorableDirections, stationName, summaries, unit, words } = input;
  const arcs = favorableDirections ?? [];
  return {
    className: RECENT_SUMMARIES_CLASS,
    ariaLabel: words.aria.recentSummaries(stationName ?? ""),
    panels: summaries.map((block) => {
      const points = block.points;
      const avgMps =
        points.length === 0
          ? null
          : points.reduce((sum, point) => sum + point.windAvgMps, 0) / points.length;
      const gusts = points.map((point) => point.windGustMps).filter((gust) => gust != null);
      const lulls = points.map((point) => point.windLullMps).filter((lull) => lull != null);
      return {
        key: block.windowMinutes,
        className: "meteo-recent-summary",
        label: {
          className: "meteo-microlabel",
          text: words.recentWindowLabel(block.windowMinutes),
        },
        stats: [
          {
            key: "avg",
            className: "meteo-recent-summary-stat",
            label: words.avgLabel,
            value: avgMps == null ? "—" : `${roundSpeed(avgMps, unit)} ${words.speedUnits[unit]}`,
          },
          {
            key: "gust",
            className: "meteo-recent-summary-stat",
            label: words.gustLabel,
            value: optionalSpeed(gusts.length === 0 ? null : Math.max(...gusts), unit),
          },
          {
            key: "lull",
            className: "meteo-recent-summary-stat",
            label: words.lullLabel,
            value: optionalSpeed(lulls.length === 0 ? null : Math.min(...lulls), unit),
          },
        ],
        ghosts: points.flatMap((point) => {
          if (point.windDirectionDeg == null) return [];
          const verdict =
            arcs.length === 0
              ? ""
              : inDirectionArcs(point.windDirectionDeg, arcs)
                ? " meteo-direction-favorable"
                : " meteo-direction-unfavorable";
          return [
            {
              key: point.observedAt,
              className: `meteo-recent-summary-ghost${verdict}`,
              deg: point.windDirectionDeg,
            },
          ];
        }),
      };
    }),
  };
}
