"use client";
import type { ReactNode } from "react";
import type { SpeedUnit, Station } from "../../index.js";
import { resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import { stationTableRowScene, stationTableScene } from "../../scene/index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { DirectionCell, StationNameLink } from "../lib/cells.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
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
  const { formatTime, strings, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    unit: unitProp,
  });
  const scene = stationTableScene(stations, words);
  return (
    <div aria-label={scene.root.ariaLabel} className={scene.root.className} role="table">
      <div className={scene.head.className} role="row">
        {scene.head.columns.map((column) => (
          <span key={column} role="columnheader">
            {column}
          </span>
        ))}
      </div>
      <div className={scene.bodyClassName} role="rowgroup">
        {stations.map((station) => (
          <TableRow
            formatTime={formatTime}
            key={station.id}
            receivedAtMs={receivedAtMs}
            servedAt={servedAt}
            station={station}
            stationMeta={stationMeta}
            strings={strings}
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
  strings,
  unit,
  words,
}: {
  formatTime: FormatTime;
  receivedAtMs: number | null;
  servedAt: string | null;
  station: Station;
  stationMeta: StationMetaRenderer | undefined;
  strings: StationStringOverrides | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}) {
  const status = useFreshness(
    station.reading?.observedAt ?? null,
    servedAt,
    receivedAtMs,
    stationFreshnessThresholds(station),
  );
  const row = stationTableRowScene({ formatTime, station, unit, words });
  const { cells } = row;
  return (
    <div className={row.className} data-status={row.status} role="row">
      <span className={row.stationCellClassName} role="cell">
        <strong>
          <StationNameLink station={station} />
        </strong>
        <small>{stationMeta ? stationMeta(station) : station.sourceLabel}</small>
      </span>
      {cells.kind === "reading" ? (
        <>
          <span className={cells.wind.className} role="cell">
            <strong>{cells.wind.value}</strong>
            <small>{cells.wind.unitLabel}</small>
          </span>
          <span className={cells.lull.className} role="cell">
            {cells.lull.value}
          </span>
          <span className={cells.gust.className} role="cell">
            {cells.gust.value}
          </span>
          <span className={cells.from.className} role="cell">
            <DirectionCell
              windAvgMps={cells.from.windAvgMps}
              windDirectionDeg={cells.from.windDirectionDeg}
              words={words}
            />
          </span>
          <span className={cells.temperature.className} role="cell">
            {cells.temperature.value}
          </span>
          <span className={cells.updated.className} role="cell">
            <span className={cells.updated.time.className}>{cells.updated.time.text}</span>
            {status != null && <FreshnessBadge status={status} strings={strings} />}
          </span>
        </>
      ) : (
        <span className={cells.className} role="cell">
          {cells.text}
        </span>
      )}
    </div>
  );
}
