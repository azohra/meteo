"use client";
import { useId } from "react";
import { resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import { currentConditionsScene } from "../../scene/index.js";
import type { SpeedUnit, Station } from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { renderScene } from "./SceneTree.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function CurrentConditions({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  thresholds: thresholdsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  station?: Station;
  stationId?: string;
  servedAt?: string | null;
  receivedAtMs?: number | null;
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const bezelId = useId();
  const station = requireResolved(
    "CurrentConditions",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const { formatTime, thresholds, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  const reading = station.status === "ok" ? station.reading : null;
  const status = useFreshness(
    reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );

  return renderScene(
    currentConditionsScene({
      bezelId: `meteo-bezel-${bezelId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
      formatTime,
      freshness: status,
      station,
      thresholds,
      unit,
      words,
    }),
  );
}
