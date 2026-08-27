"use client";
import { resolveDisplay } from "../../index.js";
import { compassFanScene, compassFanSource } from "../../scene/index.js";
import { renderOptional } from "./SceneTree.js";
import type { FavorableDirection, LiveSamples, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

/** The live compass: the newest sample as the solid needle, every sample of
 * the rolling window as a faint fan aged by tenth — a tight fan means
 * steady direction. */
export function CompassFan({
  samples,
  station: stationProp,
  stationId,
  favorableDirections: favorableDirectionsProp,
  strings: stringsProp,
}: {
  samples?: LiveSamples | null;
  station?: Station;
  stationId?: string;
  favorableDirections?: FavorableDirection[] | null;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ??
    (samples == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { favorableDirections, words } = resolveDisplay(context, {
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
  });

  return renderOptional(
    compassFanScene({
      favorableDirections,
      samples: compassFanSource(samples, station),
      station,
      stationName: station?.name,
      words,
    }),
  );
}
