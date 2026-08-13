"use client";
import { resolveDisplay, stationFreshnessThresholds } from "../../index.js";
import { currentConditionsScene } from "../../scene/index.js";
import type { SpeedUnit, Station } from "../../index.js";
import { useFreshness } from "../hooks/useFreshness.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { Dial } from "./Dial.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

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
  const station = requireResolved(
    "CurrentConditions",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const servedAt = servedAtProp ?? context?.feed?.servedAt ?? null;
  const receivedAtMs =
    receivedAtMsProp !== undefined ? receivedAtMsProp : (context?.receivedAtMs ?? null);
  const { formatTime, strings, thresholds, unit, words } = resolveDisplay(context, {
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

  const scene = currentConditionsScene({ formatTime, station, unit, words });
  const { direction, temperature, footer } = scene;

  return (
    <div
      aria-label={scene.root.ariaLabel}
      className={scene.root.className}
      data-status={scene.root.status}
      role="group"
    >
      <div className={scene.instrumentClassName}>
        {scene.flanks && (
          <div className={scene.flanks.lull.className}>
            <small className={scene.flanks.lull.labelClassName}>{scene.flanks.lull.label}</small>
            <strong>{scene.flanks.lull.value}</strong>
          </div>
        )}
        <Dial
          calmWord={false}
          station={station}
          strings={strings}
          thresholds={thresholds ?? null}
          unit={unit}
        />
        {scene.flanks && (
          <div className={scene.flanks.gust.className}>
            <small className={scene.flanks.gust.labelClassName}>{scene.flanks.gust.label}</small>
            <strong>{scene.flanks.gust.value}</strong>
          </div>
        )}
      </div>
      <p className={direction.className}>
        {direction.content.kind === "text" ? (
          direction.content.text
        ) : (
          <>
            <span className={direction.content.labelClassName}>{direction.content.label}</span>{" "}
            <WindArrow deg={direction.content.deg} /> <strong>{direction.content.compass}</strong>
            {direction.content.tail}
          </>
        )}
      </p>
      {temperature && (
        <p className={temperature.className}>
          {temperature.text}
          {temperature.chill && (
            <span className={temperature.chill.className}>{temperature.chill.text}</span>
          )}
        </p>
      )}
      <p className={footer.className}>
        {status != null && <FreshnessBadge status={status} strings={strings} />}
        <span className={footer.observed.className}>{footer.observed.text}</span>
      </p>
    </div>
  );
}
