import type { LiveSamples, Station } from "../contract.js";
import { isCalm } from "../derive.js";
import { vanePath } from "../geometry.js";
import { DIAL_SIZE, dialPolar } from "../instruments.js";
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
import { el, keyed, type SceneNode } from "./node.js";

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

/** Null without the declared live capability (when judging a station); the
 * no-samples words when the ring is empty. */
export function compassFanScene(input: {
  favorableDirections: FavorableDirection[] | undefined;
  samples: LiveSamples | null;
  station: Station | undefined;
  stationName: string | undefined;
  words: StationStrings;
}): SceneNode | null {
  const { favorableDirections, samples, station, stationName, words } = input;
  if (station != null && station.capabilities.live !== true) return null;
  if (samples == null || samples.points.length === 0) {
    return el(
      "div",
      { class: "meteo-compass-fan meteo-compass-fan-na", role: "note" },
      words.noSamples,
    );
  }

  const points = samples.points;
  const count = points.length;
  const newest = points[count - 1];
  const newestBlowing =
    newest != null && !isCalm(newest.windMps) && newest.windDirectionDeg != null;

  return el(
    "svg",
    {
      "aria-label": words.aria.compassFan(stationName ?? ""),
      class: "meteo-compass-fan-svg",
      height: DIAL_SIZE,
      role: "img",
      viewBox: `0 0 ${DIAL_SIZE} ${DIAL_SIZE}`,
      width: DIAL_SIZE,
    },
    dialRing(),
    dialVerdictRing(favorableDirections),
    dialTicks(),
    dialLetters(),
    /* One faint arrow per non-calm sample of the window, aged by tenth:
     * ghost-0 is the freshest, ghost-9 the oldest. Calm never fans — calm
     * has no direction. */
    points.slice(0, -1).flatMap((sample, index) => {
      if (isCalm(sample.windMps) || sample.windDirectionDeg == null) return [];
      const decile = Math.min(
        FAN_GHOST_STEPS - 1,
        Math.floor(((count - 1 - index) / count) * FAN_GHOST_STEPS),
      );
      const [cx, cy] = dialPolar(sample.windDirectionDeg, FAN_RADIUS);
      return [
        keyed(sample.observedAt, "path", {
          class: `meteo-fan-ghost-${decile}`,
          d: vanePath(cx, cy, sample.windDirectionDeg),
        }),
      ];
    }),
    newestBlowing && newest.windDirectionDeg != null ? dialNeedle(newest.windDirectionDeg) : null,
    dialHub(),
  );
}
