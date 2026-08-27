"use client";
import { resolveDisplay } from "../../index.js";
import { favorableShareScene, favorableShareSource } from "../../scene/index.js";
import type { FavorableDirection, HistoryPoint, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import { renderOptional } from "./SceneTree.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function FavorableShare({
  station: stationProp,
  stationId,
  points,
  favorableDirections: favorableDirectionsProp,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  points?: HistoryPoint[];
  favorableDirections?: FavorableDirection[] | null;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ?? (points == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { favorableDirections, words } = resolveDisplay(context, {
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
  });
  return renderOptional(
    favorableShareScene({
      favorableDirections,
      source: favorableShareSource(points, station),
      stationName: station?.name,
      words,
    }),
  );
}
