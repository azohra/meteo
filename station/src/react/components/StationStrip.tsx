"use client";
import type { SpeedUnit, Station } from "../../index.js";
import { resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import { stationStripScene } from "../../scene/index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import { renderScene } from "./SceneTree.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function StationStrip({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  station?: Station;
  stationId?: string;
  servedAt?: string | null;
  receivedAtMs?: number | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "StationStrip",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const { formatTime, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    unit: unitProp,
  });
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  return renderScene(stationStripScene({ formatTime, freshness: status, station, unit, words }));
}
