"use client";
import { useId, useRef } from "react";
import { resolveDisplay } from "../../index.js";
import {
  WIND_CHART_CLASS,
  readoutAriaLive,
  windChartGate,
  windChartScene,
} from "../../scene/index.js";
import { renderScene } from "./SceneTree.js";
import type { FavorableDirection, History, SpeedUnit, Station } from "../../index.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { useMeasuredChartWidth } from "../hooks/useMeasuredChartWidth.js";
import { usePinnedCursor } from "../lib/use-pinned-cursor.js";
import { Readout } from "./Readout.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function WindHistoryChart({
  station: stationProp,
  stationId,
  thresholds: thresholdsProp,
  favorableDirections: favorableDirectionsProp,
  unit: unitProp,
  plotHeight,
  windowHours,
  compareOffsetDays,
  nightShading = false,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  station?: Station;
  stationId?: string;
  thresholds?: SpeedThresholds | null;
  favorableDirections?: FavorableDirection[] | null;
  unit?: SpeedUnit;
  plotHeight?: number;
  windowHours?: number;
  compareOffsetDays?: 1 | 2 | 3;
  /** Gray sunset-to-sunrise columns from the station's own coordinates;
   * a station without them shades nothing — real astronomy or none. */
  nightShading?: boolean;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "WindHistoryChart",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { favorableDirections, formatTime, thresholds, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    thresholds: thresholdsProp,
    favorableDirections: favorableDirectionsProp,
    unit: unitProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const gate = windChartGate(station, words);
  const width = useMeasuredChartWidth(wrapRef, { enabled: gate.kind === "draw" });

  if (gate.kind === "hidden") return null;
  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  return (
    <div className={WIND_CHART_CLASS} ref={wrapRef}>
      {width != null && (
        <MeasuredChart
          compareOffsetDays={compareOffsetDays}
          favorableDirections={favorableDirections}
          formatTime={formatTime}
          history={gate.history}
          night={nightShading ? { latitude: station.latitude, longitude: station.longitude } : null}
          plotHeight={plotHeight}
          stationName={station.name}
          thresholds={thresholds}
          unit={unit}
          width={width}
          windowHours={windowHours}
          words={words}
        />
      )}
    </div>
  );
}

function MeasuredChart({
  compareOffsetDays,
  favorableDirections,
  formatTime,
  history,
  night,
  plotHeight,
  stationName,
  thresholds,
  unit,
  width,
  windowHours,
  words,
}: {
  compareOffsetDays: 1 | 2 | 3 | undefined;
  favorableDirections: FavorableDirection[] | undefined;
  formatTime: FormatTime;
  history: History;
  night: { latitude: number | null; longitude: number | null } | null;
  plotHeight: number | undefined;
  stationName: string;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  width: number;
  windowHours: number | undefined;
  words: StationStrings;
}) {
  const hatchId = `meteo-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const scene = windChartScene({
    compareOffsetDays,
    favorableDirections,
    formatTime,
    hatchId,
    history,
    night,
    plotHeight,
    stationName,
    thresholds,
    unit,
    width,
    windowHours,
    words,
  });
  const pinned = usePinnedCursor(scene);
  const { readout, cursor } = scene.inspect(pinned.activeIndex);

  return (
    <>
      <Readout
        ariaLabel={scene.readout.ariaLabel}
        ariaLive={readoutAriaLive(pinned.previewIndex)}
        className={scene.readout.className}
        parts={readout.span}
        strong={readout.strong}
      />
      {renderScene(
        scene.draw(cursor, {
          onClick: pinned.handleClick,
          onPointerLeave: pinned.handlePointerLeave,
          onPointerMove: pinned.handlePointerMove,
        }),
      )}
    </>
  );
}
