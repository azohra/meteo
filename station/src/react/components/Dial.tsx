"use client";
import { useId } from "react";
import { DIAL_SIZE, resolveDisplay } from "../../index.js";
import { dialScene } from "../../scene/index.js";
import type { FavorableDirection, SpeedThresholds, SpeedUnit, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import { renderScene } from "./SceneTree.js";

export function Dial({
  station: stationProp,
  stationId,
  thresholds: thresholdsProp,
  favorableDirections: favorableDirectionsProp,
  unit: unitProp,
  size = DIAL_SIZE,
  calmWord = true,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  thresholds?: SpeedThresholds | null;
  favorableDirections?: FavorableDirection[] | null;
  unit?: SpeedUnit;
  size?: number;
  calmWord?: boolean;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "Dial",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { favorableDirections, thresholds, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    favorableDirections: favorableDirectionsProp,
    unit: unitProp,
  });
  const bezelId = `meteo-bezel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return renderScene(
    dialScene({
      bezelId,
      calmWord,
      favorableDirections,
      size,
      station,
      thresholds,
      unit,
      words,
    }),
  );
}
