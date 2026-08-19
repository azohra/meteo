"use client";
import { resolveDisplay } from "../../index.js";
import { compassFanGate, compassFanScene, compassFanSource } from "../../scene/index.js";
import type { FavorableDirection, LiveSamples, Station } from "../../index.js";
import type { StationStringOverrides } from "../../index.js";
import { resolveStation, useStationFeedContext } from "./StationFeedProvider.js";

/** The live compass: the newest sample as the solid needle, every sample of
 * the rolling window as a faint fan aged by tenth — a tight fan means
 * steady direction. */
export function CompassFan({
  samples,
  station: stationProp,
  stationId,
  favorableDirections: favorableDirectionsProp,
  strings: stringsProp,
}: {
  samples?: LiveSamples | null;
  station?: Station;
  stationId?: string;
  favorableDirections?: FavorableDirection[] | null;
  strings?: StationStringOverrides;
}) {
  const context = useStationFeedContext();
  const station =
    stationProp ??
    (samples == null ? (resolveStation(context, stationId) ?? undefined) : undefined);
  const { favorableDirections, words } = resolveDisplay(context, {
    strings: stringsProp,
    favorableDirections: favorableDirectionsProp,
  });
  const source = compassFanSource(samples, station);
  const gate = compassFanGate(source, station, words);
  if (gate.kind === "hidden") return null;
  if (gate.kind === "note") {
    return (
      <div className={gate.className} role="note">
        {gate.text}
      </div>
    );
  }

  const scene = compassFanScene({
    favorableDirections,
    samples: gate.samples,
    stationName: station?.name,
    words,
  });
  return (
    <svg
      aria-label={scene.svg.ariaLabel}
      className={scene.svg.className}
      height={scene.svg.height}
      role="img"
      viewBox={scene.svg.viewBox}
      width={scene.svg.width}
    >
      <circle
        className={scene.ring.className}
        cx={scene.ring.cx}
        cy={scene.ring.cy}
        r={scene.ring.r}
      />
      {scene.verdictRing && (
        <>
          <circle
            className={scene.verdictRing.unfavorable.className}
            cx={scene.verdictRing.unfavorable.cx}
            cy={scene.verdictRing.unfavorable.cy}
            r={scene.verdictRing.unfavorable.r}
          />
          {scene.verdictRing.favorable.map((arc) => (
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
      {scene.ghosts.map((ghost) => (
        <path className={ghost.className} d={ghost.d} key={ghost.key} />
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
    </svg>
  );
}
