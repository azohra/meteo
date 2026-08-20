"use client";
import { useRef } from "react";
import { resolveDisplay } from "../../index.js";
import {
  SAMPLE_STRIP_CLASS,
  readoutAriaLive,
  sampleStripGate,
  sampleStripScene,
} from "../../scene/index.js";
import type { FavorableDirection, LiveSamples, SpeedUnit } from "../../index.js";
import type { FormatTime, StationStringOverrides, StationStrings } from "../../index.js";
import { useMeasuredChartWidth } from "../hooks/useMeasuredChartWidth.js";
import { usePinnedCursor } from "../lib/use-pinned-cursor.js";
import { Readout } from "./Readout.js";
import { useStationFeedContext } from "./StationFeedProvider.js";

/* The history chart's live sibling, samples-only by design: the rolling
 * sample window in, the same frame and rows out. The host owns the live
 * subscription (useStationLive) and hands the window over; instants stay
 * ungraded — thresholds grade sustained wind, never a single sample. */
export function WindSampleStrip({
  samples,
  stationName,
  unit: unitProp,
  favorableDirections: favorableDirectionsProp,
  plotHeight,
  strings: stringsProp,
  formatTime: formatTimeProp,
}: {
  samples: LiveSamples | null | undefined;
  stationName: string;
  unit?: SpeedUnit;
  favorableDirections?: FavorableDirection[] | null;
  plotHeight?: number;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const { favorableDirections, formatTime, unit, words } = resolveDisplay(context, {
    formatTime: formatTimeProp,
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
    unit: unitProp,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const gate = sampleStripGate(samples, words);
  const width = useMeasuredChartWidth(wrapRef, { enabled: gate.kind === "draw" });

  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  return (
    <div className={SAMPLE_STRIP_CLASS} ref={wrapRef}>
      {width != null && (
        <MeasuredStrip
          favorableDirections={favorableDirections}
          formatTime={formatTime}
          plotHeight={plotHeight}
          samples={gate.samples}
          stationName={stationName}
          unit={unit}
          width={width}
          words={words}
        />
      )}
    </div>
  );
}

function MeasuredStrip({
  favorableDirections,
  formatTime,
  plotHeight,
  samples,
  stationName,
  unit,
  width,
  words,
}: {
  favorableDirections: FavorableDirection[] | undefined;
  formatTime: FormatTime;
  plotHeight: number | undefined;
  samples: LiveSamples;
  stationName: string;
  unit: SpeedUnit;
  width: number;
  words: StationStrings;
}) {
  const scene = sampleStripScene({
    favorableDirections,
    formatTime,
    plotHeight,
    samples,
    stationName,
    unit,
    width,
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
        {scene.trace.map((part) =>
          part.kind === "dot" ? (
            <circle
              className={part.className}
              cx={part.cx}
              cy={part.cy}
              key={part.key}
              r={part.r}
            />
          ) : (
            <polyline className={part.className} key={part.key} points={part.points} />
          ),
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
        {scene.vanes.map(
          (vane) =>
            vane.label && (
              <text
                className={vane.label.className}
                key={`label-${vane.key}`}
                textAnchor={vane.label.anchor}
                x={vane.label.x}
                y={vane.label.y}
              >
                {vane.label.text}
              </text>
            ),
        )}
        <text
          className={scene.rowLabels.avg.className}
          textAnchor={scene.rowLabels.avg.anchor}
          x={scene.rowLabels.avg.x}
          y={scene.rowLabels.avg.y}
        >
          {scene.rowLabels.avg.text}
        </text>
        {scene.vanes.map(
          (vane) =>
            vane.value && (
              <text
                className={vane.value.className}
                key={`value-${vane.key}`}
                textAnchor={vane.value.anchor}
                x={vane.value.x}
                y={vane.value.y}
              >
                {vane.value.text}
              </text>
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
          onClick={pinned.handleClick}
          onPointerLeave={pinned.handlePointerLeave}
          onPointerMove={pinned.handlePointerMove}
          width={scene.hit.width}
          x={scene.hit.x}
          y={scene.hit.y}
        />
      </svg>
    </>
  );
}
