import { inDirectionArcs } from "@azohra/meteo.core";
import type { RecentSummary, Station } from "../contract.js";
import type { SpeedUnit } from "../derive.js";
import { optionalSpeed, roundSpeed } from "../format.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import { windArrowNode } from "./glyphs.js";
import { el, keyed, type SceneNode } from "./node.js";

export const RECENT_SUMMARIES_CLASS = "meteo-recent-summaries";

/** Null unless the source declares the capability; the no-samples words
 * when the declared block is dark. */
export function recentSummariesScene(input: {
  favorableDirections: FavorableDirection[] | undefined;
  station: Station | undefined;
  summaries: RecentSummary[] | null | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}): SceneNode | null {
  const { favorableDirections, station, summaries, unit, words } = input;
  const source = summaries ?? (station?.status === "ok" ? (station.recentSummaries ?? null) : null);
  if (station != null && station.capabilities.recentSummaries !== true) return null;
  if (source == null || source.length === 0) {
    return el(
      "div",
      { class: "meteo-recent-summaries meteo-recent-summaries-na", role: "note" },
      words.noSamples,
    );
  }
  const arcs = favorableDirections ?? [];

  const stat = (key: string, label: string, value: string) =>
    keyed(
      key,
      "div",
      { class: "meteo-recent-summary-stat" },
      el("dt", { class: "meteo-microlabel" }, label),
      el("dd", undefined, value),
    );

  return el(
    "div",
    {
      "aria-label": words.aria.recentSummaries(station?.name ?? ""),
      class: RECENT_SUMMARIES_CLASS,
    },
    source.map((block) => {
      const points = block.points;
      const avgMps =
        points.length === 0
          ? null
          : points.reduce((sum, point) => sum + point.windAvgMps, 0) / points.length;
      const gusts = points.map((point) => point.windGustMps).filter((gust) => gust != null);
      const lulls = points.map((point) => point.windLullMps).filter((lull) => lull != null);
      return keyed(
        String(block.windowMinutes),
        "section",
        { class: "meteo-recent-summary" },
        el("h4", { class: "meteo-microlabel" }, words.recentWindowLabel(block.windowMinutes)),
        el(
          "div",
          { class: "meteo-recent-summary-ghosts" },
          points.flatMap((point) => {
            if (point.windDirectionDeg == null) return [];
            const verdict =
              arcs.length === 0
                ? ""
                : inDirectionArcs(point.windDirectionDeg, arcs)
                  ? " meteo-direction-favorable"
                  : " meteo-direction-unfavorable";
            return [
              keyed(
                point.observedAt,
                "span",
                { class: `meteo-recent-summary-ghost${verdict}` },
                windArrowNode(point.windDirectionDeg, 12),
              ),
            ];
          }),
        ),
        el(
          "dl",
          { class: "meteo-recent-summary-stats" },
          stat(
            "avg",
            words.avgLabel,
            avgMps == null ? "\u2014" : `${roundSpeed(avgMps, unit)} ${words.speedUnits[unit]}`,
          ),
          stat(
            "gust",
            words.gustLabel,
            optionalSpeed(gusts.length === 0 ? null : Math.max(...gusts), unit),
          ),
          stat(
            "lull",
            words.lullLabel,
            optionalSpeed(lulls.length === 0 ? null : Math.min(...lulls), unit),
          ),
        ),
      );
    }),
  );
}
