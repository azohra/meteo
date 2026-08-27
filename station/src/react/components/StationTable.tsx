"use client";
import type { ReactNode } from "react";
import type { SpeedUnit, Station } from "../../index.js";
import { resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import {
  TABLE_BODY_CLASS,
  TABLE_ROW_CLASS,
  TABLE_STATION_CELL_CLASS,
  stationTableHeadNode,
  stationTableRootAttrs,
  stationTableRowCells,
} from "../../scene/index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { StationNameLink } from "../lib/cells.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import { renderChildren, renderScene } from "./SceneTree.js";
import { requireResolved, useStationFeedContext } from "./StationFeedProvider.js";

export type StationMetaRenderer = (station: Station) => ReactNode;

export function StationTable({
  stations: stationsProp,
  servedAt: servedAtProp,
  receivedAtMs: receivedAtMsProp,
  unit: unitProp,
  strings: stringsProp,
  formatTime: formatTimeProp,
  stationMeta,
}: {
  stations?: readonly Station[];
  servedAt?: string;
  receivedAtMs?: number | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
  stationMeta?: StationMetaRenderer;
}) {
  const context = useStationFeedContext();
  const stations = requireResolved(
    "StationTable",
    "stations",
    stationsProp ?? context?.feed?.stations,
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const { formatTime, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    unit: unitProp,
  });
  const root = stationTableRootAttrs(stations, words);
  return (
    <div aria-label={root["aria-label"]} className={root["class"]} role="table">
      {renderScene(stationTableHeadNode(words))}
      <div className={TABLE_BODY_CLASS} role="rowgroup">
        {stations.map((station) => (
          <TableRow
            formatTime={formatTime}
            key={station.id}
            receivedAtMs={receivedAtMs}
            servedAt={servedAt}
            station={station}
            stationMeta={stationMeta}
            unit={unit}
            words={words}
          />
        ))}
      </div>
    </div>
  );
}

function TableRow({
  formatTime,
  receivedAtMs,
  servedAt,
  station,
  stationMeta,
  unit,
  words,
}: {
  formatTime: FormatTime;
  receivedAtMs: number | null;
  servedAt: string | null;
  station: Station;
  stationMeta: StationMetaRenderer | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}) {
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  return (
    <div className={TABLE_ROW_CLASS} data-status={station.status} role="row">
      <span className={TABLE_STATION_CELL_CLASS} role="cell">
        <strong>
          <StationNameLink station={station} />
        </strong>
        <small>{stationMeta ? stationMeta(station) : station.sourceLabel}</small>
      </span>
      {renderChildren(
        stationTableRowCells({ formatTime, freshness: status, station, unit, words }),
      )}
    </div>
  );
}
