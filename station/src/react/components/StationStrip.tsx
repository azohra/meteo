"use client";
import type { SpeedUnit, Station } from "../../index.js";
import { resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import { stationStripScene } from "../../scene/index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import { DirectionCell, StationNameLink } from "../lib/cells.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
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
  const { formatTime, strings, unit, words } = resolveDisplay(context, {
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
  const scene = stationStripScene({ formatTime, station, unit, words });
  const { body } = scene;
  return (
    <div
      aria-label={scene.root.ariaLabel}
      className={scene.root.className}
      data-status={scene.root.status}
      role="group"
    >
      <span className={scene.stationClassName}>
        <StationNameLink station={station} />
      </span>
      {body.kind === "reading" ? (
        <>
          <span className={body.wind.className}>
            <strong>{body.wind.value}</strong>
            <small>{body.wind.unitLabel}</small>
          </span>
          {body.gustLull && (
            <>
              <span className={body.gustLull.lull.className}>
                <small className={body.gustLull.lull.labelClassName}>
                  {body.gustLull.lull.label}
                </small>
                {body.gustLull.lull.value}
              </span>
              <span className={body.gustLull.gust.className}>
                <small className={body.gustLull.gust.labelClassName}>
                  {body.gustLull.gust.label}
                </small>
                {body.gustLull.gust.value}
              </span>
            </>
          )}
          <span className={body.from.className}>
            <DirectionCell
              windAvgMps={body.from.windAvgMps}
              windDirectionDeg={body.from.windDirectionDeg}
              words={words}
            />
          </span>
          {body.temperature && (
            <span className={body.temperature.className}>{body.temperature.text}</span>
          )}
          <span className={body.updated.className}>
            <span className={body.updated.time.className}>{body.updated.time.text}</span>
            {status != null && <FreshnessBadge status={status} strings={strings} />}
          </span>
        </>
      ) : (
        <span className={body.className}>{body.text}</span>
      )}
    </div>
  );
}
