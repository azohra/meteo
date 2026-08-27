"use client";
import { resolveDisplay } from "../../index.js";
import { windRoseScene, windRoseSource } from "../../scene/index.js";
import type { FavorableDirection, HistoryPoint, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { renderScene } from "./SceneTree.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function WindRose({
  station: stationProp,
  stationId,
  points,
  sectorCount = 16,
  thresholds: thresholdsProp,
  favorableDirections: favorableDirectionsProp,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  points?: HistoryPoint[];
  sectorCount?: number;
  thresholds?: SpeedThresholds | null;
  favorableDirections?: FavorableDirection[] | null;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ?? (points == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { favorableDirections, thresholds, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    favorableDirections: favorableDirectionsProp,
  });
  return renderScene(
    windRoseScene({
      favorableDirections,
      sectorCount,
      source: windRoseSource(points, station),
      stationName: station?.name,
      thresholds,
      words,
    }),
  );
}
