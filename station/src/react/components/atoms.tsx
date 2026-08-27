"use client";
import { useEffect, useState } from "react";
import { subscribeTicker } from "../../client/index.js";
import { resolveDisplay } from "../../index.js";
import {
  bandChipNode,
  directionAtomNode,
  pressureAtomScene,
  speedAtomScene,
  temperatureAtomScene,
  updatedAtNode,
  valueAtomNode,
} from "../../scene/index.js";
import type { FavorableDirection, SpeedUnit, Station } from "../../index.js";
import type { SpeedKind } from "../../format.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { renderScene } from "./SceneTree.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import type { StationFeedContextValue } from "./StationFeedProvider.js";

type AtomProps = {
  station?: Station;
  stationId?: string;
  strings?: StationStringOverrides;
};

type SpeedAtomProps = AtomProps & {
  unit?: SpeedUnit;
};

function useResolvedStation(
  component: string,
  stationProp: Station | undefined,
  stationId: string | undefined,
): { context: StationFeedContextValue | null; station: Station } {
  const context = useStationFeedContext();
  const station = requireResolved(
    component,
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  return { context, station };
}

function SpeedValue({
  component,
  kind,
  station: stationProp,
  stationId,
  unit: unitProp,
  strings: stringsProp,
}: SpeedAtomProps & { component: string; kind: SpeedKind }) {
  const { context, station } = useResolvedStation(component, stationProp, stationId);
  const { unit, words } = resolveDisplay(context, { strings: stringsProp, unit: unitProp });
  return renderScene(valueAtomNode(speedAtomScene(station, kind, unit, words)));
}

export function Speed(props: SpeedAtomProps) {
  return <SpeedValue component="Speed" kind="average" {...props} />;
}

export function Gust(props: SpeedAtomProps) {
  return <SpeedValue component="Gust" kind="gust" {...props} />;
}

export function Lull(props: SpeedAtomProps) {
  return <SpeedValue component="Lull" kind="lull" {...props} />;
}

export function Temperature({ station: stationProp, stationId, strings: stringsProp }: AtomProps) {
  const { context, station } = useResolvedStation("Temperature", stationProp, stationId);
  const { words } = resolveDisplay(context, { strings: stringsProp });
  return renderScene(valueAtomNode(temperatureAtomScene(station, words)));
}

export function Pressure({ station: stationProp, stationId, strings: stringsProp }: AtomProps) {
  const { context, station } = useResolvedStation("Pressure", stationProp, stationId);
  const { words } = resolveDisplay(context, { strings: stringsProp });
  return renderScene(valueAtomNode(pressureAtomScene(station, words)));
}

export function Direction({
  station: stationProp,
  stationId,
  strings: stringsProp,
  favorableDirections: favorableDirectionsProp,
}: AtomProps & { favorableDirections?: FavorableDirection[] | null }) {
  const { context, station } = useResolvedStation("Direction", stationProp, stationId);
  const { favorableDirections, words } = resolveDisplay(context, {
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
  });
  return renderScene(directionAtomNode(station, words, favorableDirections));
}

export function UpdatedAt({
  station: stationProp,
  stationId,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  station?: Station;
  stationId?: string;
  servedAt?: string | null;
  receivedAtMs?: number | null;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const { context, station } = useResolvedStation("UpdatedAt", stationProp, stationId);
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const { formatTime, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
  });
  const [nowMs, setNowMs] = useState(() => receivedAtMs ?? Date.now());
  useEffect(() => {
    setNowMs(Date.now());
    return subscribeTicker(() => setNowMs(Date.now()));
  }, []);
  return renderScene(updatedAtNode({ formatTime, nowMs, receivedAtMs, servedAt, station, words }));
}

export function BandChip({
  station: stationProp,
  stationId,
  thresholds: thresholdsProp,
  labels,
  unit: unitProp,
  strings: stringsProp,
}: SpeedAtomProps & {
  thresholds?: SpeedThresholds | null;
  labels?: readonly string[];
}) {
  const { context, station } = useResolvedStation("BandChip", stationProp, stationId);
  const { thresholds, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  return renderScene(bandChipNode({ labels, station, thresholds, unit, words }));
}
