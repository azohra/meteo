import { componentsToWind, stabilityClass } from "../derive/index.js";
import { interpolateVertical } from "./field.js";
import type { BarbPlacement, CursorReading, MeteogramScene, SceneSelection } from "./types.js";

/** The mount's bounding rect, in client pixels — structurally what `getBoundingClientRect()` returns. */
export interface MountRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Client-pixel position -> scene coordinates against the mount rect; x and y scale independently, and a zero-area rect returns null. */
export function clientPointToScene(
  scene: MeteogramScene,
  rect: MountRect,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * scene.width,
    y: ((clientY - rect.top) / rect.height) * scene.height,
  };
}

/** Column-centre x for an hour index. */
export function xForHour(scene: MeteogramScene, index: number): number {
  return scene.scales.plotLeft + index * scene.scales.columnWidth + scene.scales.columnWidth / 2;
}

export function yForAltitude(scene: MeteogramScene, altitudeM: number): number {
  const { plotTop, plotHeight, floorM, topM } = scene.scales;
  return plotTop + plotHeight * (1 - (altitudeM - floorM) / (topM - floorM));
}

export function altitudeForY(scene: MeteogramScene, y: number): number {
  const { plotTop, plotHeight, floorM, topM } = scene.scales;
  return topM - ((y - plotTop) / plotHeight) * (topM - floorM);
}

/** Nearest hour column for a plot x; null outside the plot, unless `{ clamp: true }` resolves an outside x to the nearest edge column. */
export function hourIndexForX(
  scene: MeteogramScene,
  x: number,
  options: { clamp?: boolean } = {},
): number | null {
  const { plotLeft, plotWidth, columnWidth, hourCount } = scene.scales;
  if (hourCount === 0) return null;
  if (!options.clamp && (x < plotLeft || x > plotLeft + plotWidth)) return null;
  return Math.min(hourCount - 1, Math.max(0, Math.floor((x - plotLeft) / columnWidth)));
}

/** The rendered hour index whose `validAt` names the same instant (compared as timestamps, not strings); null when the scene renders no such hour — the pin-carry primitive across rebuilds. */
export function hourIndexForValidAt(scene: MeteogramScene, validAt: string | Date): number | null {
  const ms = validAt instanceof Date ? validAt.getTime() : Date.parse(validAt);
  if (Number.isNaN(ms)) return null;
  const index = scene.hourValidAts.findIndex((candidate) => Date.parse(candidate) === ms);
  return index === -1 ? null : index;
}

/**
 * Fractional x for an instant — sub-hour positioning, piecewise linear
 * between adjacent hour centres, extrapolating across the edge
 * half-columns but never past the plot frame. Instants outside the frame
 * return null unless `{ clamp: true }` pins them to the frame edge; a
 * single-hour scene has no time scale, so only its own instant resolves.
 */
export function xForTime(
  scene: MeteogramScene,
  validAt: string | Date,
  options: { clamp?: boolean } = {},
): number | null {
  const { plotLeft, plotWidth, hourCount } = scene.scales;
  const ms = validAt instanceof Date ? validAt.getTime() : Date.parse(validAt);
  if (Number.isNaN(ms) || hourCount === 0) return null;
  const times = scene.hourValidAts.map((candidate) => Date.parse(candidate));
  if (hourCount === 1) {
    return ms === times[0] || options.clamp ? xForHour(scene, 0) : null;
  }
  const found = times.findIndex((time) => time >= ms);
  const upper = Math.min(hourCount - 1, Math.max(1, found === -1 ? hourCount - 1 : found));
  const lower = upper - 1;
  const fraction = (ms - times[lower]) / (times[upper] - times[lower]);
  const x = xForHour(scene, lower) + fraction * (xForHour(scene, upper) - xForHour(scene, lower));
  if (options.clamp) return Math.min(plotLeft + plotWidth, Math.max(plotLeft, x));
  return x < plotLeft || x > plotLeft + plotWidth ? null : x;
}

/** The barbs actually drawn in one hour's column, exactly as rendered (stride and min-gap thinning applied) — the discrete ladder an inspector snaps to, where `cursorReading` interpolates the continuous column. */
export function drawnBarbsForHour(
  scene: MeteogramScene,
  hourIndex: number,
): ReadonlyArray<BarbPlacement> {
  return scene.barbs.filter((barb) => barb.hourIndex === hourIndex);
}

/** The drawn barb nearest a scene y within one hour's column; ties keep the lower barb, and an hour that drew no barbs returns null. */
export function nearestDrawnBarb(
  scene: MeteogramScene,
  hourIndex: number,
  y: number,
): BarbPlacement | null {
  let nearest: BarbPlacement | null = null;
  for (const barb of scene.barbs) {
    if (barb.hourIndex !== hourIndex) continue;
    if (nearest === null || Math.abs(barb.y - y) < Math.abs(nearest.y - y)) nearest = barb;
  }
  return nearest;
}

/**
 * A selection resolved to scene geometry — the one resolver
 * `buildMeteogramScene` itself calls for its `selection` option, so a
 * consumer overlay and the serializer-drawn pin can never disagree. The
 * hour clamps into the window, a requested altitude snaps to the hour's
 * nearest drawn barb, and only an empty scene returns null.
 */
export function resolveSelection(
  scene: MeteogramScene,
  selection: { hourIndex: number; altitudeM?: number | null },
): SceneSelection | null {
  const { plotLeft, plotTop, plotHeight, columnWidth, stripTop, hourCount } = scene.scales;
  if (hourCount === 0) return null;
  const hourIndex = Math.min(hourCount - 1, Math.max(0, Math.floor(selection.hourIndex)));
  let barb: SceneSelection["barb"] = null;
  if (selection.altitudeM != null) {
    const nearest = nearestDrawnBarb(scene, hourIndex, yForAltitude(scene, selection.altitudeM));
    if (nearest !== null) {
      barb = {
        x: nearest.x,
        y: nearest.y,
        altitudeM: nearest.altitudeM,
        surface: nearest.surface,
        scale: nearest.scale,
      };
    }
  }
  const x = plotLeft + hourIndex * columnWidth;
  return {
    hourIndex,
    x,
    width: columnWidth,
    centerX: x + columnWidth / 2,
    top: stripTop,
    bottom: plotTop + plotHeight,
    barb,
  };
}

/**
 * Interpolated column values under a cursor position (scene px). Null when
 * the cursor is outside the plot; individual quantities are null where the
 * column has no data at that altitude (e.g. above the top level, or a model
 * without levels at all).
 */
export function cursorReading(scene: MeteogramScene, x: number, y: number): CursorReading | null {
  const { plotTop, plotHeight } = scene.scales;
  const hourIndex = hourIndexForX(scene, x);
  if (hourIndex === null || y < plotTop || y > plotTop + plotHeight) return null;
  const sampling = scene.sampling[hourIndex];
  const altitudeM = altitudeForY(scene, y);

  const temperatureC = interpolateVertical(sampling.temperatureC, altitudeM);
  const dewPointC = interpolateVertical(sampling.dewPointC, altitudeM);
  const lapse = interpolateVertical(sampling.lapseCPer1000Ft, altitudeM);
  const uMps = interpolateVertical(sampling.windU, altitudeM);
  const vMps = interpolateVertical(sampling.windV, altitudeM);
  const wind = uMps === null || vMps === null ? null : componentsToWind(uMps, vMps);

  return {
    hourIndex,
    validAt: sampling.validAt,
    altitudeM,
    temperatureC,
    dewPointC,
    dewPointDepressionC:
      temperatureC === null || dewPointC === null ? null : temperatureC - dewPointC,
    relativeHumidityPercent: interpolateVertical(sampling.relativeHumidityPercent, altitudeM),
    lapseCPer1000Ft: lapse,
    stabilityClassName: lapse === null ? null : stabilityClass(lapse),
    thermalIndexC: interpolateVertical(sampling.thermalIndexC, altitudeM),
    windSpeedMps: wind === null ? null : wind.speedMps,
    windDirectionDeg: wind === null ? null : wind.directionDeg,
    verticalVelocityPaS: interpolateVertical(sampling.verticalVelocityPaS, altitudeM),
    smokeSurfaceUgm3: sampling.smoke === null ? null : sampling.smoke.surfaceUgm3,
    smokeAot: sampling.smoke === null ? null : sampling.smoke.aot,
    observedIrradianceWm2: sampling.observation === null ? null : sampling.observation.wm2,
    observedTransmittance:
      sampling.observation === null ? null : sampling.observation.transmittance,
    observedAot: sampling.aotObservation === null ? null : sampling.aotObservation.aot,
  };
}
