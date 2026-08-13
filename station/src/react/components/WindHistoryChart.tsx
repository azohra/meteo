"use client";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { resolveDisplay } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  WIND_CHART_CLASS,
  activeChartIndex,
  chartIndexAtClient,
  measuredChartWidth,
  readoutAriaLive,
  togglePinnedAt,
  windChartGate,
  windChartScene,
} from "../../scene/index.js";
import type { History, SpeedUnit, Station } from "../../index.js";
import type { ReadoutPart } from "../../scene/index.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";
import { WindArrow } from "./WindArrow.js";

export function WindHistoryChart({
  station: stationProp,
  stationId,
  thresholds: thresholdsProp,
  unit: unitProp,
  plotHeight,
  windowHours,
  compareOffsetDays,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  station?: Station;
  stationId?: string;
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  plotHeight?: number;
  windowHours?: number;
  compareOffsetDays?: 1 | 2 | 3;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "WindHistoryChart",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { formatTime, thresholds, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  const gate = windChartGate(station, words);
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
          formatTime={formatTime}
          history={gate.history}
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

function ReadoutSpan({ parts }: { parts: ReadoutPart[] }) {
  return (
    <span>
      {parts.map((part, index) =>
        part.kind === "arrow" ? <WindArrow deg={part.deg} key={index} /> : part.text,
      )}
    </span>
  );
}

function MeasuredChart({
  compareOffsetDays,
  formatTime,
  history,
  plotHeight,
  stationName,
  thresholds,
  unit,
  width,
  windowHours,
  words,
}: {
  compareOffsetDays: 1 | 2 | 3 | undefined;
  formatTime: FormatTime;
  history: History;
  plotHeight: number | undefined;
  stationName: string;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  width: number;
  windowHours: number | undefined;
  words: StationStrings;
}) {
  const hatchId = `meteo-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [pinnedAt, setPinnedAt] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const scene = windChartScene({
    compareOffsetDays,
    formatTime,
    hatchId,
    history,
    plotHeight,
    stationName,
    thresholds,
    unit,
    width,
    windowHours,
    words,
  });
  const { readout, cursor } = scene.inspect(activeChartIndex(scene.points, pinnedAt, previewIndex));

  const indexAtPoint = (clientX: number, hit: SVGRectElement): number | null => {
    const svg = hit.ownerSVGElement;
    if (!svg) return null;
    const bounds = svg.getBoundingClientRect();
    return chartIndexAtClient(scene.points, scene.frame, scene.scales, clientX, bounds);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.pointerType === "touch") return;
    setPreviewIndex(indexAtPoint(event.clientX, event.currentTarget));
  };

  const handleClick = (event: ReactMouseEvent<SVGRectElement>) => {
    const index = indexAtPoint(event.clientX, event.currentTarget);
    if (index == null) return;
    const observedAt = scene.points[index]?.observedAt;
    if (observedAt == null) return;
    setPinnedAt((current) => togglePinnedAt(current, observedAt));
    setPreviewIndex(null);
  };

  return (
    <>
      <output
        aria-label={scene.readout.ariaLabel}
        aria-live={readoutAriaLive(previewIndex)}
        className={scene.readout.className}
      >
        <strong>{readout.strong}</strong>
        <ReadoutSpan parts={readout.span} />
      </output>
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
          <clipPath id={scene.defs.clip.id}>
            <rect
              height={scene.defs.clip.rect.height}
              width={scene.defs.clip.rect.width}
              x={scene.defs.clip.rect.x}
              y={scene.defs.clip.rect.y}
            />
          </clipPath>
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
        {scene.band && <polygon className={scene.band.className} points={scene.band.points} />}
        {scene.compare && (
          <polyline
            className={scene.compare.className}
            clipPath={scene.compare.clipPath}
            points={scene.compare.points}
          />
        )}
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
        {cursor && (
          <>
            <line
              className={cursor.line.className}
              x1={cursor.line.x1}
              x2={cursor.line.x2}
              y1={cursor.line.y1}
              y2={cursor.line.y2}
            />
            <circle
              className={cursor.dot.className}
              cx={cursor.dot.cx}
              cy={cursor.dot.cy}
              r={cursor.dot.r}
            />
          </>
        )}
        <rect
          className={scene.hit.className}
          fill={scene.hit.fill}
          height={scene.hit.height}
          onClick={handleClick}
          onPointerLeave={() => setPreviewIndex(null)}
          onPointerMove={handlePointerMove}
          width={scene.hit.width}
          x={scene.hit.x}
          y={scene.hit.y}
        />
      </svg>
    </>
  );
}
