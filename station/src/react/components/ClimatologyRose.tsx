"use client";
import { resolveDisplay } from "../../index.js";
import { climatologyRoseScene } from "../../scene/index.js";
import type { FavorableDirection, StationClimatology } from "../../index.js";
import type { ClimatologyFilters, StationStringOverrides } from "../../index.js";
import { renderScene } from "./SceneTree.js";
import { useStationFeedContext } from "./StationFeedProvider.js";

/** The whole archive as a stacked rose: the cube's sectors, each wedge split
 * by the document's own thresholds, with the honesty captions beneath. The
 * host owns the document (a fetch-once store) and the filters. */
export function ClimatologyRose({
  document,
  months,
  slots,
  favorableDirections: favorableDirectionsProp,
  stationName,
  strings: stringsProp,
}: {
  document: StationClimatology | null | undefined;
  months?: ReadonlyArray<number>;
  slots?: ReadonlyArray<number>;
  favorableDirections?: FavorableDirection[] | null;
  stationName?: string;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const { favorableDirections, words } = resolveDisplay(context, {
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
  });
  const filters: ClimatologyFilters = { months, slots };
  return renderScene(
    climatologyRoseScene({ document, favorableDirections, filters, stationName, words }),
  );
}
