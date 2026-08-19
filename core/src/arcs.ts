import { normalizeDegrees } from "./angles.js";

/** One arc of meteorological FROM bearings, degrees clockwise from north;
 * `fromDeg > toDeg` wraps through north ({ fromDeg: 315, toDeg: 45 } spans NW
 * through NE). Both boundaries are inclusive. */
export type DirectionArc = {
  fromDeg: number;
  toDeg: number;
};

/** Whether a meteorological FROM bearing falls inside any arc. */
export function inDirectionArcs(directionDeg: number, arcs: ReadonlyArray<DirectionArc>): boolean {
  const direction = normalizeDegrees(directionDeg);
  return arcs.some((arc) => {
    const from = normalizeDegrees(arc.fromDeg);
    const to = normalizeDegrees(arc.toDeg);
    return from <= to ? direction >= from && direction <= to : direction >= from || direction <= to;
  });
}

/** The arc's clockwise span in degrees, in [0, 360); fromDeg === toDeg reads
 * as a single bearing, not a full circle. */
export function directionArcSpanDeg(arc: DirectionArc): number {
  return normalizeDegrees(arc.toDeg - arc.fromDeg);
}
