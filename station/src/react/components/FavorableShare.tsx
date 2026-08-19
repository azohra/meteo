"use client";
import { resolveDisplay } from "../../index.js";
import {
  favorableShareGate,
  favorableShareScene,
  favorableShareSource,
} from "../../scene/index.js";
import type { FavorableDirection, HistoryPoint, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
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
  const source = favorableShareSource(points, station);
  const gate = favorableShareGate(source, favorableDirections, words);
  if (gate.kind === "hidden") return null;
  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  const scene = favorableShareScene({ share: gate.share, stationName: station?.name, words });
  return (
    <div aria-label={scene.ariaLabel} className={scene.className}>
      <span className={scene.label.className}>{scene.label.text}</span>{" "}
      <span className={scene.value.className}>{scene.value.text}</span>
    </div>
  );
}
