"use client";
import { useEffect, useId, useRef, useState } from "react";
import { DAILY_PATTERN_DEFAULT_SLOT_MINUTES, resolveDisplay } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  DAILY_PATTERN_CLASS,
  dailyPatternGate,
  dailyPatternScene,
  dailyPatternSource,
  measuredChartWidth,
} from "../../scene/index.js";
import { renderChildren } from "./SceneTree.js";
import type { FavorableDirection, HistoryPoint, SpeedUnit, Station } from "../../index.js";
import type { StationStringOverrides, StationStrings } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function DailyPattern({
  station: stationProp,
  stationId,
  points,
  slotMinutes = DAILY_PATTERN_DEFAULT_SLOT_MINUTES,
  utcOffsetMinutes = 0,
  thresholds: thresholdsProp,
  favorableDirections: favorableDirectionsProp,
  unit: unitProp,
  plotHeight,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  points?: HistoryPoint[];
  slotMinutes?: number;
  utcOffsetMinutes?: number;
  thresholds?: SpeedThresholds | null;
  favorableDirections?: FavorableDirection[] | null;
  unit?: SpeedUnit;
  plotHeight?: number;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ?? (points == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { favorableDirections, thresholds, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    favorableDirections: favorableDirectionsProp,
    unit: unitProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  const { source, periodMinutes } = dailyPatternSource(points, station);
  const gate = dailyPatternGate(source, words);
  const drawable = gate.kind === "draw";

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(CHART_FALLBACK_WIDTH);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(measuredChartWidth(entries[0]?.contentRect.width ?? 0));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [drawable]);

  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  return (
    <div className={DAILY_PATTERN_CLASS} ref={wrapRef}>
      {width != null && (
        <MeasuredDailyPattern
          favorableDirections={favorableDirections}
          periodMinutes={periodMinutes}
          plotHeight={plotHeight}
          points={source}
          slotMinutes={slotMinutes}
          stationName={station?.name}
          thresholds={thresholds}
          unit={unit}
          utcOffsetMinutes={utcOffsetMinutes}
          width={width}
          words={words}
        />
      )}
    </div>
  );
}

function MeasuredDailyPattern({
  favorableDirections,
  periodMinutes,
  plotHeight,
  points,
  slotMinutes,
  stationName,
  thresholds,
  unit,
  utcOffsetMinutes,
  width,
  words,
}: {
  favorableDirections: FavorableDirection[] | undefined;
  periodMinutes: number | null;
  plotHeight: number | undefined;
  points: HistoryPoint[];
  slotMinutes: number;
  stationName: string | undefined;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  utcOffsetMinutes: number;
  width: number;
  words: StationStrings;
}) {
  const hatchId = `meteo-daily-pattern-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const scene = dailyPatternScene({
    favorableDirections,
    hatchId,
    periodMinutes,
    plotHeight,
    points,
    slotMinutes,
    stationName,
    thresholds,
    unit,
    utcOffsetMinutes,
    width,
    words,
  });

  return renderChildren(scene);
}
