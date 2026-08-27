"use client";
import { resolveDisplay } from "../../index.js";
import { sparklineScene } from "../../scene/index.js";
import type { SpeedUnit, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import { renderScene } from "./SceneTree.js";

export function Sparkline({
  station: stationProp,
  stationId,
  width = 120,
  height = 32,
  showBand = true,
  thresholds: thresholdsProp,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  width?: number;
  height?: number;
  showBand?: boolean;
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "Sparkline",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { thresholds, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
  });

  return renderScene(sparklineScene({ height, showBand, station, thresholds, width, words }));
}
