"use client";
import type { ReactNode } from "react";
import { resolveDisplay } from "../../index.js";
import { windRoseGate, windRoseScene, windRoseSource } from "../../scene/index.js";
import type { WindRoseScene } from "../../scene/index.js";
import type { FavorableDirection, HistoryPoint, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import type { SpeedThresholds } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

export function WindRose({
  station: stationProp,
  stationId,
  points,
  sectorCount = 16,
  thresholds: thresholdsProp,
  favorableDirections: favorableDirectionsProp,
  strings: stringsProp,
}: {
  station?: Station;
  stationId?: string;
  points?: HistoryPoint[];
  sectorCount?: number;
  thresholds?: SpeedThresholds | null;
  favorableDirections?: FavorableDirection[] | null;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ?? (points == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { favorableDirections, thresholds, words } = resolveDisplay(context, {
    strings: stringsProp,
    thresholds: thresholdsProp,
    favorableDirections: favorableDirectionsProp,
  });
  const source = windRoseSource(points, station);
  const gate = windRoseGate(source, words);
  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  const scene = windRoseScene({
    favorableDirections,
    sectorCount,
    source,
    stationName: station?.name,
    thresholds,
    words,
  });

  return <WindRoseSceneView scene={scene} />;
}

/** One scene, one drawing — shared by the history-fed rose above and the
 * climatology-fed twin, which appends its caption row as children. */
export function WindRoseSceneView({
  scene,
  children,
}: {
  scene: WindRoseScene;
  children?: ReactNode;
}) {
  return (
    <div className={scene.className}>
      <svg
        aria-label={scene.svg.ariaLabel}
        className={scene.svg.className}
        height={scene.svg.height}
        role="img"
        viewBox={scene.svg.viewBox}
        width={scene.svg.width}
      >
        {scene.gridCircles.map((circle) => (
          <circle
            className={circle.className}
            cx={circle.cx}
            cy={circle.cy}
            key={circle.key}
            r={circle.r}
          />
        ))}
        {scene.ring && (
          <>
            <circle
              className={scene.ring.unfavorable.className}
              cx={scene.ring.unfavorable.cx}
              cy={scene.ring.unfavorable.cy}
              r={scene.ring.unfavorable.r}
            />
            {scene.ring.favorable.map((arc) => (
              <path className={arc.className} d={arc.d} key={arc.key} />
            ))}
          </>
        )}
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
        {scene.petals.map((petal) => (
          <path className={petal.className} d={petal.d} key={petal.key} />
        ))}
        {scene.ringLabel && (
          <text
            className={scene.ringLabel.className}
            textAnchor={scene.ringLabel.anchor}
            x={scene.ringLabel.x}
            y={scene.ringLabel.y}
          >
            {scene.ringLabel.text}
          </text>
        )}
        <circle
          className={scene.hub.className}
          cx={scene.hub.cx}
          cy={scene.hub.cy}
          r={scene.hub.r}
        />
        <circle
          className={scene.dot.className}
          cx={scene.dot.cx}
          cy={scene.dot.cy}
          r={scene.dot.r}
        />
      </svg>
      {scene.calmCaption && <p className={scene.calmCaption.className}>{scene.calmCaption.text}</p>}
      {children}
    </div>
  );
}
