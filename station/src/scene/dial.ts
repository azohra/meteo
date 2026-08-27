import type { Station } from "../contract.js";
import { isCalm, thresholdsToMps } from "../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import { roundSpeed } from "../format.js";
import { speedBand } from "../geometry.js";
import {
  DIAL_CENTRE,
  DIAL_RING_RADIUS,
  DIAL_SIZE,
  dialScaleMaxMps,
  dialSpeedArcPath,
} from "../instruments.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import {
  dialHub,
  dialLetters,
  dialNeedle,
  dialRing,
  dialTicks,
  dialVerdictRing,
} from "./dial-parts.js";
import { el, keyed, type SceneChild, type SceneNode } from "./node.js";

export function dialScene(input: {
  bezelId: string;
  calmWord: boolean;
  favorableDirections?: FavorableDirection[] | undefined;
  size: number;
  station: Station;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}): SceneNode {
  const { bezelId, calmWord, favorableDirections, size, station, thresholds, unit, words } = input;
  const shown = (windAvgMps: number) => roundSpeed(windAvgMps, unit);
  const unitLabel = words.speedUnits[unit];
  const reading = station.status === "ok" ? station.reading : null;
  const calm = reading != null && isCalm(reading.windAvgMps);
  const blowing = reading != null && !calm && reading.windDirectionDeg != null;

  const dialMax = dialScaleMaxMps(reading?.windAvgMps ?? null, reading?.windGustMps ?? null, unit);
  const arcFraction = reading == null ? 0 : Math.min(1, Math.max(0, reading.windAvgMps) / dialMax);
  const boundsMps = thresholds == null ? null : thresholdsToMps(thresholds);
  const arcBand =
    reading != null && boundsMps != null ? speedBand(reading.windAvgMps, boundsMps) : null;

  const dialLabel =
    station.status === "unavailable"
      ? `${station.name}: ${words.reasons[station.reason]}`
      : calm
        ? `${station.name}: ${words.calm}, ${shown(station.reading.windAvgMps)} ${unitLabel}`
        : `${station.name}: ${shown(station.reading.windAvgMps)} ${unitLabel}`;

  const centreText = (className: string, y: number, text: string): SceneNode =>
    el("text", { class: className, "text-anchor": "middle", x: DIAL_CENTRE, y }, text);

  const centre: SceneChild[] =
    reading == null
      ? [centreText("meteo-wind-dial-reason", DIAL_CENTRE + 4, words.notReporting)]
      : [
          calm && calmWord
            ? centreText("meteo-wind-dial-reason", DIAL_CENTRE - 22, words.calm)
            : null,
          centreText("meteo-wind-dial-speed", DIAL_CENTRE + 8, String(shown(reading.windAvgMps))),
          centreText("meteo-wind-dial-unit", DIAL_CENTRE + 26, unitLabel),
        ];

  return el(
    "svg",
    {
      "aria-label": dialLabel,
      class:
        station.status === "unavailable"
          ? "meteo-wind-dial meteo-wind-dial-unavailable"
          : "meteo-wind-dial",
      height: size,
      role: "img",
      viewBox: `0 0 ${DIAL_SIZE} ${DIAL_SIZE}`,
      width: size,
    },
    el(
      "defs",
      undefined,
      el(
        "radialGradient",
        { cx: "50%", cy: "42%", id: bezelId, r: "68%" },
        keyed("55%", "stop", { class: "meteo-wind-dial-bezel-in", offset: "55%" }),
        keyed("100%", "stop", { class: "meteo-wind-dial-bezel-out", offset: "100%" }),
      ),
    ),
    el("circle", {
      class: "meteo-wind-dial-face",
      cx: DIAL_CENTRE,
      cy: DIAL_CENTRE,
      r: DIAL_RING_RADIUS,
    }),
    el("circle", {
      class: "meteo-wind-dial-bezel",
      cx: DIAL_CENTRE,
      cy: DIAL_CENTRE,
      fill: `url(#${bezelId})`,
      r: DIAL_RING_RADIUS,
    }),
    dialRing(),
    dialVerdictRing(favorableDirections),
    reading != null && arcFraction > 0
      ? el("path", {
          class:
            arcBand == null ? "meteo-wind-dial-arc" : `meteo-wind-dial-arc meteo-band-${arcBand}`,
          d: dialSpeedArcPath(arcFraction),
        })
      : null,
    dialTicks(),
    dialLetters(),
    blowing && reading.windDirectionDeg != null ? dialNeedle(reading.windDirectionDeg) : null,
    dialHub(),
    centre,
  );
}
