"use client";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { resolveDisplay } from "../../index.js";
import { CHART_FALLBACK_WIDTH } from "../../geometry.js";
import {
  TREND_CLASS,
  activeChartIndex,
  chartIndexAtClient,
  measuredChartWidth,
  readoutAriaLive,
  togglePinnedAt,
  trendGate,
  trendScene,
} from "../../scene/index.js";
import type { History, Station } from "../../index.js";
import type { TrendSeries } from "../../geometry.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function TrendChart({
  station: stationProp,
  stationId,
  series,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  station?: Station;
  stationId?: string;
  series: TrendSeries;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "TrendChart",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { formatTime, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  const gate = trendGate(station, series, words);
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
    <div className={TREND_CLASS} ref={wrapRef}>
      {width != null && (
        <MeasuredTrend
          formatTime={formatTime}
          history={gate.history}
          series={series}
          stationName={station.name}
          width={width}
          words={words}
        />
      )}
    </div>
  );
}

function MeasuredTrend({
  formatTime,
  history,
  series,
  stationName,
  width,
  words,
}: {
  formatTime: FormatTime;
  history: History;
  series: TrendSeries;
  stationName: string;
  width: number;
  words: StationStrings;
}) {
  const [pinnedAt, setPinnedAt] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const scene = trendScene({ formatTime, history, series, stationName, width, words });
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
        <span>{readout.span}</span>
      </output>
      <svg
        aria-label={scene.svg.ariaLabel}
        className={scene.svg.className}
        height={scene.svg.height}
        role="img"
        viewBox={scene.svg.viewBox}
        width={scene.svg.width}
      >
        {scene.grid.map(({ key, line, label }) => (
          <g key={key}>
            <line className={line.className} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
            <text className={label.className} textAnchor={label.anchor} x={label.x} y={label.y}>
              {label.text}
            </text>
          </g>
        ))}
        {scene.segments.map((segment) =>
          segment.kind === "dot" ? (
            <circle
              className={segment.className}
              cx={segment.cx}
              cy={segment.cy}
              key={segment.startedAt}
              r={segment.r}
            />
          ) : (
            <polyline
              className={segment.className}
              key={segment.startedAt}
              points={segment.points}
            />
          ),
        )}
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
            {cursor.dot && (
              <circle
                className={cursor.dot.className}
                cx={cursor.dot.cx}
                cy={cursor.dot.cy}
                r={cursor.dot.r}
              />
            )}
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
