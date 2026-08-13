"use client";
import { useId } from "react";
import { DIAL_SIZE, resolveDisplay } from "../../index.js";
import { dialScene } from "../../scene/index.js";
import type { SpeedThresholds, SpeedUnit, Station } from "../../index.js";
import type { FormatTime, StationStringOverrides } from "../../index.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function Dial({
  station: stationProp,
  stationId,
  thresholds: thresholdsProp,
  unit: unitProp,
  size = DIAL_SIZE,
  calmWord = true,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  size?: number;
  calmWord?: boolean;
  strings?: StationStringOverrides;
  formatTime?: FormatTime;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "Dial",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { thresholds, unit, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    unit: unitProp,
  });
  const bezelId = `meteo-bezel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const scene = dialScene({ bezelId, calmWord, size, station, thresholds, unit, words });
  const { gradient, centre } = scene;

  return (
    <svg
      aria-label={scene.svg.ariaLabel}
      className={scene.svg.className}
      height={scene.svg.height}
      role="img"
      viewBox={scene.svg.viewBox}
      width={scene.svg.width}
    >
      <defs>
        <radialGradient cx={gradient.cx} cy={gradient.cy} id={gradient.id} r={gradient.r}>
          {gradient.stops.map((stop) => (
            <stop className={stop.className} key={stop.offset} offset={stop.offset} />
          ))}
        </radialGradient>
      </defs>
      <circle
        className={scene.face.className}
        cx={scene.face.cx}
        cy={scene.face.cy}
        r={scene.face.r}
      />
      <circle
        className={scene.bezel.className}
        cx={scene.bezel.cx}
        cy={scene.bezel.cy}
        fill={scene.bezel.fill}
        r={scene.bezel.r}
      />
      <circle
        className={scene.ring.className}
        cx={scene.ring.cx}
        cy={scene.ring.cy}
        r={scene.ring.r}
      />
      {scene.arc && <path className={scene.arc.className} d={scene.arc.d} />}
      {scene.ticks.map((tick) => (
        <line
          className={tick.className}
          key={tick.key}
          x1={tick.x1}
          x2={tick.x2}
          y1={tick.y1}
          y2={tick.y2}
        />
      ))}
      {scene.letters.map((letter) => (
        <text
          className={letter.className}
          key={letter.key}
          textAnchor={letter.anchor}
          x={letter.x}
          y={letter.y}
        >
          {letter.text}
        </text>
      ))}
      {scene.needle && (
        <g className={scene.needle.className}>
          <polygon className={scene.needle.blade.className} points={scene.needle.blade.points} />
          <circle
            className={scene.needle.counterweight.className}
            cx={scene.needle.counterweight.cx}
            cy={scene.needle.counterweight.cy}
            r={scene.needle.counterweight.r}
          />
        </g>
      )}
      <circle className={scene.hub.className} cx={scene.hub.cx} cy={scene.hub.cy} r={scene.hub.r} />
      {centre.kind === "reason" ? (
        <text
          className={centre.text.className}
          textAnchor={centre.text.anchor}
          x={centre.text.x}
          y={centre.text.y}
        >
          {centre.text.text}
        </text>
      ) : (
        <>
          {centre.calmWord && (
            <text
              className={centre.calmWord.className}
              textAnchor={centre.calmWord.anchor}
              x={centre.calmWord.x}
              y={centre.calmWord.y}
            >
              {centre.calmWord.text}
            </text>
          )}
          <text
            className={centre.speed.className}
            textAnchor={centre.speed.anchor}
            x={centre.speed.x}
            y={centre.speed.y}
          >
            {centre.speed.text}
          </text>
          <text
            className={centre.unit.className}
            textAnchor={centre.unit.anchor}
            x={centre.unit.x}
            y={centre.unit.y}
          >
            {centre.unit.text}
          </text>
        </>
      )}
    </svg>
  );
}
