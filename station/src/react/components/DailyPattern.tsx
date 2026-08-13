"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  DAILY_PATTERN_DEFAULT_SLOT_MINUTES,
  compassDirection,
  resolveDisplay,
} from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  DAILY_PATTERN_CLASS,
  dailyPatternGate,
  dailyPatternScene,
  dailyPatternSource,
  measuredChartWidth,
} from "../../scene/index.js";
import type { HistoryPoint, SpeedUnit, Station } from "../../index.js";
import type { StationStringOverrides, StationStrings } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

export function DailyPattern({
  station: stationProp,
  stationId,
  points,
  slotMinutes = DAILY_PATTERN_DEFAULT_SLOT_MINUTES,
  utcOffsetMinutes = 0,
  thresholds: thresholdsProp,
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
  unit?: SpeedUnit;
  plotHeight?: number;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ?? (points == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { thresholds, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
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

  return (
    <>
      <output className={scene.caption.className}>{scene.caption.text}</output>
      <svg
        aria-label={scene.svg.ariaLabel}
        className={scene.svg.className}
        height={scene.svg.height}
        role="img"
        viewBox={scene.svg.viewBox}
        width={scene.svg.width}
      >
        <defs>
          <pattern
            height={scene.defs.pattern.height}
            id={scene.defs.pattern.id}
            patternTransform={scene.defs.pattern.transform}
            patternUnits={scene.defs.pattern.units}
            width={scene.defs.pattern.width}
          >
            <line
              className={scene.defs.pattern.line.className}
              x1={scene.defs.pattern.line.x1}
              x2={scene.defs.pattern.line.x2}
              y1={scene.defs.pattern.line.y1}
              y2={scene.defs.pattern.line.y2}
            />
          </pattern>
        </defs>
        {scene.zones.map((zone) => (
          <rect
            className={zone.className}
            height={zone.height}
            key={zone.key}
            width={zone.width}
            x={zone.x}
            y={zone.y}
          />
        ))}
        {scene.grid.map(({ key, line, label }) => (
          <g key={key}>
            <line className={line.className} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
            <text className={label.className} textAnchor={label.anchor} x={label.x} y={label.y}>
              {label.text}
            </text>
          </g>
        ))}
        {scene.thresholdGuides.map(({ key, line, label }) => (
          <g key={key}>
            <line className={line.className} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
            <text className={label.className} textAnchor={label.anchor} x={label.x} y={label.y}>
              {label.text}
            </text>
          </g>
        ))}
        {scene.vaneGuides.map((guide) => (
          <line
            className={guide.className}
            key={`guide-${guide.key}`}
            x1={guide.x1}
            x2={guide.x2}
            y1={guide.y1}
            y2={guide.y2}
          />
        ))}
        {scene.gaps.map((gap) => (
          <rect
            className={gap.className}
            fill={gap.fill}
            height={gap.height}
            key={gap.key}
            width={gap.width}
            x={gap.x}
            y={gap.y}
          />
        ))}
        {scene.mean.kind === "polyline" ? (
          <polyline className={scene.mean.className} points={scene.mean.points} />
        ) : (
          scene.mean.segments.map((segment) => (
            <line
              className={segment.className}
              key={segment.key}
              x1={segment.x1}
              x2={segment.x2}
              y1={segment.y1}
              y2={segment.y2}
            />
          ))
        )}
        {scene.calmNote && (
          <text
            className={scene.calmNote.className}
            textAnchor={scene.calmNote.anchor}
            x={scene.calmNote.x}
            y={scene.calmNote.y}
          >
            {scene.calmNote.text}
          </text>
        )}
        <text
          className={scene.rowLabels.to.className}
          textAnchor={scene.rowLabels.to.anchor}
          x={scene.rowLabels.to.x}
          y={scene.rowLabels.to.y}
        >
          {scene.rowLabels.to.text}
        </text>
        {scene.vanes.map((vane) =>
          vane.mark.kind === "calm" ? (
            <text
              className={vane.mark.text.className}
              key={vane.key}
              textAnchor={vane.mark.text.anchor}
              x={vane.mark.text.x}
              y={vane.mark.text.y}
            >
              {vane.mark.text.text}
            </text>
          ) : (
            <path className={vane.mark.className} d={vane.mark.d} key={vane.key} />
          ),
        )}
        {scene.vanes.map((vane) => (
          <text
            className={vane.label.className}
            key={`label-${vane.key}`}
            textAnchor={vane.label.anchor}
            x={vane.label.x}
            y={vane.label.y}
          >
            {vane.label.text}
          </text>
        ))}
        <text
          className={scene.rowLabels.avg.className}
          textAnchor={scene.rowLabels.avg.anchor}
          x={scene.rowLabels.avg.x}
          y={scene.rowLabels.avg.y}
        >
          {scene.rowLabels.avg.text}
        </text>
        {scene.vanes.map((vane) => (
          <text
            className={vane.value.className}
            key={`value-${vane.key}`}
            textAnchor={vane.value.anchor}
            x={vane.value.x}
            y={vane.value.y}
          >
            {vane.value.text}
          </text>
        ))}
        {scene.ticks.map((tick) => (
          <text
            className={tick.className}
            key={tick.key}
            textAnchor={tick.anchor}
            x={tick.x}
            y={tick.y}
          >
            {tick.text}
          </text>
        ))}
      </svg>
    </>
  );
}

export { compassDirection, WindArrow };
