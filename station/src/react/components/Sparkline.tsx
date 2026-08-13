"use client";
import { resolveDisplay } from "../../index.js";
import { sparklineScene } from "../../scene/index.js";
import type { SpeedUnit, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { requireResolved, resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function Sparkline({
  station: stationProp,
  stationId,
  width = 120,
  height = 32,
  showBand = true,
  thresholds: thresholdsProp,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  width?: number;
  height?: number;
  showBand?: boolean;
  thresholds?: SpeedThresholds | null;
  unit?: SpeedUnit;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station = requireResolved(
    "Sparkline",
    "station",
    stationProp ?? resolveStation(context, stationId),
  );
  const { thresholds, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
  });

  const scene = sparklineScene({ height, showBand, station, thresholds, width, words });

  if (scene.kind === "placeholder") {
    return (
      <span
        aria-label={scene.ariaLabel}
        className={scene.className}
        role="img"
        style={{ height: scene.height, width: scene.width }}
      >
        {scene.text}
      </span>
    );
  }

  return (
    <svg
      aria-label={scene.svg.ariaLabel}
      className={scene.svg.className}
      height={scene.svg.height}
      role="img"
      viewBox={scene.svg.viewBox}
      width={scene.svg.width}
    >
      {scene.bands.map((band) => (
        <polygon className={band.className} key={band.key} points={band.points} />
      ))}
      {scene.trace.map((part) =>
        part.kind === "dot" ? (
          <circle className={part.className} cx={part.cx} cy={part.cy} key={part.key} r={part.r} />
        ) : part.kind === "polyline" ? (
          <polyline className={part.className} key={part.key} points={part.points} />
        ) : (
          <line
            className={part.className}
            key={part.key}
            x1={part.x1}
            x2={part.x2}
            y1={part.y1}
            y2={part.y2}
          />
        ),
      )}
    </svg>
  );
}
