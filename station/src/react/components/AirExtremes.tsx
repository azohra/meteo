"use client";
import { resolveDisplay } from "../../index.js";
import { airExtremesGate, airExtremesScene } from "../../scene/index.js";
import type { Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

/** Derived atmo tiles from served history: the last completed night's low
 * (real astronomy — no coordinates, no tile) and the trailing pressure
 * delta. Nothing derivable, nothing rendered. */
export function AirExtremes({
  station: stationProp,
  stationId,
  nowMs,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  /** Pinned in tests; defaults to the wall clock. */
  nowMs?: number;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station = stationProp ?? resolveStation(context, stationId) ?? undefined;
  const { words } = resolveDisplay(context, { strings: stringsProp });
  const gate = airExtremesGate(station);
  if (gate.kind === "hidden") return null;

  const scene = airExtremesScene({
    nowMs: nowMs ?? Date.now(),
    station: gate.station,
    words,
  });
  if (scene == null) return null;
  return (
    <dl aria-label={scene.ariaLabel} className={scene.className}>
      {scene.tiles.map((tile) => (
        <div className={tile.className} key={tile.key}>
          <dt className="meteo-microlabel">{tile.label}</dt>
          <dd className="meteo-air-extremes-value">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
