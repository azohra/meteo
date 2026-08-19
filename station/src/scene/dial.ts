import type { Station } from "../contract.js";
import { isCalm, thresholdsToMps } from "../derive.js";
import type { SpeedThresholds, SpeedUnit } from "../derive.js";
import { roundSpeed } from "../format.js";
import { speedBand } from "../geometry.js";
import {
  DIAL_CARDINALS,
  DIAL_CARDINAL_TICK_INNER,
  DIAL_CENTRE,
  DIAL_COUNTERWEIGHT_RADIUS,
  DIAL_COUNTERWEIGHT_REACH,
  DIAL_HUB_RADIUS,
  DIAL_LETTER_RADIUS,
  DIAL_RING_RADIUS,
  DIAL_SIZE,
  DIAL_TICK_INNER,
  dialNeedlePoints,
  dialPolar,
  dialRingArcPath,
  dialScaleMaxMps,
  dialSpeedArcPath,
} from "../instruments.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";
import type { SceneText } from "./wind-plot.js";

type DialCircle = { className: string; cx: number; cy: number; r: number };

export type DialScene = {
  svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
  gradient: {
    id: string;
    cx: string;
    cy: string;
    r: string;
    stops: Array<{ className: string; offset: string }>;
  };
  face: DialCircle;
  bezel: DialCircle & { fill: string };
  ring: DialCircle;
  verdictRing: {
    unfavorable: DialCircle;
    favorable: Array<{ key: string; className: string; d: string }>;
  } | null;
  arc: { className: string; d: string } | null;
  ticks: Array<{ key: number; className: string; x1: number; x2: number; y1: number; y2: number }>;
  letters: Array<{
    key: string;
    className: string;
    anchor: "middle";
    x: number;
    y: number;
    text: string;
  }>;
  needle: {
    className: string;
    blade: { className: string; points: string };
    counterweight: { className: string; cx: number; cy: number; r: number };
  } | null;
  hub: DialCircle;
  centre:
    | { kind: "reason"; text: SceneText }
    | { kind: "reading"; calmWord: SceneText | null; speed: SceneText; unit: SceneText };
};

export function dialScene(input: {
  bezelId: string;
  calmWord: boolean;
  favorableDirections?: FavorableDirection[] | undefined;
  size: number;
  station: Station;
  thresholds: SpeedThresholds | undefined;
  unit: SpeedUnit;
  words: StationStrings;
}): DialScene {
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

  return {
    svg: {
      ariaLabel: dialLabel,
      className:
        station.status === "unavailable"
          ? "meteo-wind-dial meteo-wind-dial-unavailable"
          : "meteo-wind-dial",
      height: size,
      viewBox: `0 0 ${DIAL_SIZE} ${DIAL_SIZE}`,
      width: size,
    },
    gradient: {
      id: bezelId,
      cx: "50%",
      cy: "42%",
      r: "68%",
      stops: [
        { className: "meteo-wind-dial-bezel-in", offset: "55%" },
        { className: "meteo-wind-dial-bezel-out", offset: "100%" },
      ],
    },
    face: {
      className: "meteo-wind-dial-face",
      cx: DIAL_CENTRE,
      cy: DIAL_CENTRE,
      r: DIAL_RING_RADIUS,
    },
    bezel: {
      className: "meteo-wind-dial-bezel",
      cx: DIAL_CENTRE,
      cy: DIAL_CENTRE,
      fill: `url(#${bezelId})`,
      r: DIAL_RING_RADIUS,
    },
    ring: {
      className: "meteo-wind-dial-ring",
      cx: DIAL_CENTRE,
      cy: DIAL_CENTRE,
      r: DIAL_RING_RADIUS,
    },
    verdictRing:
      favorableDirections != null && favorableDirections.length > 0
        ? {
            unfavorable: {
              className: "meteo-wind-dial-ring-unfavorable",
              cx: DIAL_CENTRE,
              cy: DIAL_CENTRE,
              r: DIAL_RING_RADIUS,
            },
            favorable: favorableDirections.map((sector) => ({
              key: `${sector.fromDeg}-${sector.toDeg}`,
              className: "meteo-wind-dial-ring-favorable",
              d: dialRingArcPath(sector),
            })),
          }
        : null,
    arc:
      reading != null && arcFraction > 0
        ? {
            className:
              arcBand == null ? "meteo-wind-dial-arc" : `meteo-wind-dial-arc meteo-band-${arcBand}`,
            d: dialSpeedArcPath(arcFraction),
          }
        : null,
    ticks: Array.from({ length: 16 }, (_, index) => {
      const bearing = index * 22.5;
      const cardinal = index % 4 === 0;
      const [x1, y1] = dialPolar(bearing, DIAL_RING_RADIUS);
      const [x2, y2] = dialPolar(bearing, cardinal ? DIAL_CARDINAL_TICK_INNER : DIAL_TICK_INNER);
      return {
        key: bearing,
        className: cardinal
          ? "meteo-wind-dial-tick meteo-wind-dial-tick-cardinal"
          : "meteo-wind-dial-tick",
        x1,
        x2,
        y1,
        y2,
      };
    }),
    letters: DIAL_CARDINALS.map(({ bearing, letter }) => {
      const [x, y] = dialPolar(bearing, DIAL_LETTER_RADIUS);
      return {
        key: letter,
        className: "meteo-wind-dial-letter",
        anchor: "middle" as const,
        x,
        y: y + 3.5,
        text: letter,
      };
    }),
    needle:
      blowing && reading.windDirectionDeg != null
        ? {
            className: "meteo-wind-needle",
            blade: {
              className: "meteo-wind-needle-blade",
              points: dialNeedlePoints(reading.windDirectionDeg),
            },
            counterweight: {
              className: "meteo-wind-needle-counterweight",
              cx: dialPolar(reading.windDirectionDeg, DIAL_COUNTERWEIGHT_REACH)[0],
              cy: dialPolar(reading.windDirectionDeg, DIAL_COUNTERWEIGHT_REACH)[1],
              r: DIAL_COUNTERWEIGHT_RADIUS,
            },
          }
        : null,
    hub: { className: "meteo-wind-dial-hub", cx: DIAL_CENTRE, cy: DIAL_CENTRE, r: DIAL_HUB_RADIUS },
    centre:
      reading == null
        ? {
            kind: "reason",
            text: {
              className: "meteo-wind-dial-reason",
              anchor: "middle",
              x: DIAL_CENTRE,
              y: DIAL_CENTRE + 4,
              text: words.notReporting,
            },
          }
        : {
            kind: "reading",
            calmWord:
              calm && calmWord
                ? {
                    className: "meteo-wind-dial-reason",
                    anchor: "middle",
                    x: DIAL_CENTRE,
                    y: DIAL_CENTRE - 22,
                    text: words.calm,
                  }
                : null,
            speed: {
              className: "meteo-wind-dial-speed",
              anchor: "middle",
              x: DIAL_CENTRE,
              y: DIAL_CENTRE + 8,
              text: String(shown(reading.windAvgMps)),
            },
            unit: {
              className: "meteo-wind-dial-unit",
              anchor: "middle",
              x: DIAL_CENTRE,
              y: DIAL_CENTRE + 26,
              text: unitLabel,
            },
          },
  };
}
