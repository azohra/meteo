import type { LiveSamples, Station } from "../contract.js";
import { isCalm } from "../derive.js";
import { vanePath } from "../geometry.js";
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
} from "../instruments.js";
import type { FavorableDirection } from "../instruments.js";
import type { StationStrings } from "../strings.js";

export const COMPASS_FAN_CLASS = "meteo-compass-fan";

/* Where the ghost arrows sit — between the letters and the ring. */
const FAN_RADIUS = 58;
const FAN_GHOST_STEPS = 10;

export function compassFanSource(
  samples: LiveSamples | null | undefined,
  station: Station | undefined,
): LiveSamples | null {
  return samples ?? (station?.status === "ok" ? (station.samples ?? null) : null);
}

export type CompassFanGate =
  | { kind: "draw"; samples: LiveSamples }
  | { kind: "hidden" }
  | { kind: "note"; className: string; text: string };

/** hidden without the declared live capability (when judging a station);
 * the no-samples words when the ring is empty. */
export function compassFanGate(
  source: LiveSamples | null,
  station: Station | undefined,
  words: StationStrings,
): CompassFanGate {
  if (station != null && station.capabilities.live !== true) return { kind: "hidden" };
  if (source == null || source.points.length === 0) {
    return {
      kind: "note",
      className: `${COMPASS_FAN_CLASS} meteo-compass-fan-na`,
      text: words.noSamples,
    };
  }
  return { kind: "draw", samples: source };
}

type FanCircle = { className: string; cx: number; cy: number; r: number };

export type CompassFanScene = {
  svg: { ariaLabel: string; className: string; height: number; viewBox: string; width: number };
  ring: FanCircle;
  verdictRing: {
    unfavorable: FanCircle;
    favorable: Array<{ key: string; className: string; d: string }>;
  } | null;
  ticks: Array<{ key: number; className: string; x1: number; x2: number; y1: number; y2: number }>;
  letters: Array<{
    key: string;
    className: string;
    anchor: "middle";
    x: number;
    y: number;
    text: string;
  }>;
  /** Oldest first, newest excluded — the newest is drawn as the needle. */
  ghosts: Array<{ key: string; className: string; d: string }>;
  needle: {
    className: string;
    blade: { className: string; points: string };
    counterweight: { className: string; cx: number; cy: number; r: number };
  } | null;
  hub: FanCircle;
};

export function compassFanScene(input: {
  favorableDirections: FavorableDirection[] | undefined;
  samples: LiveSamples;
  stationName: string | undefined;
  words: StationStrings;
}): CompassFanScene {
  const { favorableDirections, samples, stationName, words } = input;
  const points = samples.points;
  const count = points.length;
  const newest = points[count - 1];
  const newestBlowing =
    newest != null && !isCalm(newest.windMps) && newest.windDirectionDeg != null;

  return {
    svg: {
      ariaLabel: words.aria.compassFan(stationName ?? ""),
      className: "meteo-compass-fan-svg",
      height: DIAL_SIZE,
      viewBox: `0 0 ${DIAL_SIZE} ${DIAL_SIZE}`,
      width: DIAL_SIZE,
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
    /* One faint arrow per non-calm sample of the window, aged by tenth:
     * ghost-0 is the freshest, ghost-9 the oldest. Calm never fans — calm
     * has no direction. */
    ghosts: points.slice(0, -1).flatMap((sample, index) => {
      if (isCalm(sample.windMps) || sample.windDirectionDeg == null) return [];
      const decile = Math.min(
        FAN_GHOST_STEPS - 1,
        Math.floor(((count - 1 - index) / count) * FAN_GHOST_STEPS),
      );
      const [cx, cy] = dialPolar(sample.windDirectionDeg, FAN_RADIUS);
      return [
        {
          key: sample.observedAt,
          className: `meteo-fan-ghost-${decile}`,
          d: vanePath(cx, cy, sample.windDirectionDeg),
        },
      ];
    }),
    needle:
      newestBlowing && newest.windDirectionDeg != null
        ? {
            className: "meteo-wind-needle",
            blade: {
              className: "meteo-wind-needle-blade",
              points: dialNeedlePoints(newest.windDirectionDeg),
            },
            counterweight: {
              className: "meteo-wind-needle-counterweight",
              cx: dialPolar(newest.windDirectionDeg, DIAL_COUNTERWEIGHT_REACH)[0],
              cy: dialPolar(newest.windDirectionDeg, DIAL_COUNTERWEIGHT_REACH)[1],
              r: DIAL_COUNTERWEIGHT_RADIUS,
            },
          }
        : null,
    hub: {
      className: "meteo-wind-dial-hub",
      cx: DIAL_CENTRE,
      cy: DIAL_CENTRE,
      r: DIAL_HUB_RADIUS,
    },
  };
}
