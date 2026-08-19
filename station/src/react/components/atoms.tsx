"use client";
import { useEffect, useState } from "react";
import { subscribeTicker } from "../../client/index.js";
import { resolveDisplay } from "../../index.js";
import {
  bandChipScene,
  directionAtomScene,
  pressureAtomScene,
  speedAtomScene,
  temperatureAtomScene,
  updatedAtScene,
} from "../../scene/index.js";
import type { FavorableDirection, SpeedUnit, Station } from "../../index.js";
import type { SpeedKind } from "../../format.js";
import type { ValueAtomScene } from "../../scene/index.js";
import { DirectionCell } from "../lib/cells.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
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

function ValueAtom({ scene }: { scene: ValueAtomScene }) {
  return (
    <data className={scene.className} value={scene.value}>
      {scene.content.kind === "dash" ? (
        scene.content.text
      ) : (
        <>
          {scene.content.text}
          <span className={scene.content.unit.className}>{scene.content.unit.text}</span>
        </>
      )}
    </data>
  );
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
  return <ValueAtom scene={speedAtomScene(station, kind, unit, words)} />;
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
  return <ValueAtom scene={temperatureAtomScene(station, words)} />;
}

export function Pressure({ station: stationProp, stationId, strings: stringsProp }: AtomProps) {
  const { context, station } = useResolvedStation("Pressure", stationProp, stationId);
  const { words } = resolveDisplay(context, { strings: stringsProp });
  return <ValueAtom scene={pressureAtomScene(station, words)} />;
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
  const scene = directionAtomScene(station, words, favorableDirections);
  if (scene.cell == null) {
    return <span className={scene.className}>{scene.dashText}</span>;
  }
  return (
    <span aria-label={scene.ariaLabel} className={scene.className}>
      <DirectionCell
        windAvgMps={scene.cell.windAvgMps}
        windDirectionDeg={scene.cell.windDirectionDeg}
        words={words}
      />
    </span>
  );
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
  const scene = updatedAtScene({ formatTime, nowMs, receivedAtMs, servedAt, station, words });
  if (scene.kind === "dash") {
    return <span className={scene.className}>{scene.text}</span>;
  }
  return (
    <time className={scene.className} dateTime={scene.dateTime}>
      {scene.text}
    </time>
  );
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
  const scene = bandChipScene({ labels, station, thresholds, unit, words });
  return (
    <span className={scene.className} data-band={scene.band}>
      {scene.text}
    </span>
  );
}
