"use client";
import { resolveDisplay } from "../../index.js";
import { recentSummariesScene } from "../../scene/index.js";
import type { FavorableDirection, RecentSummary, Station } from "../../index.js";
import type { SpeedUnit, StationStringOverrides } from "../../index.js";
import { renderOptional } from "./SceneTree.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

/** The source's own step digests as summary panels: per window, the
 * average, gust, and lull beside one small arrow per step. */
export function RecentSummaries({
  summaries,
  station: stationProp,
  stationId,
  favorableDirections: favorableDirectionsProp,
  unit: unitProp,
  strings: stringsProp,
}: {
  summaries?: RecentSummary[] | null;
  station?: Station;
  stationId?: string;
  favorableDirections?: FavorableDirection[] | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ??
    (summaries == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { favorableDirections, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
    unit: unitProp,
  });
  return renderOptional(
    recentSummariesScene({ favorableDirections, station, summaries, unit, words }),
  );
}
