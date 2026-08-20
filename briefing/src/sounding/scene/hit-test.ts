import { componentsToWind } from "../../derive/index.js";
import {
  altitudeForY as altitudeForYOnScale,
  yForAltitude as yForAltitudeOnScale,
} from "../../scene/altitude-axis.js";
import { interpolateVertical } from "../../scene/field.js";
import type { SoundingReading, SoundingScene } from "./types.js";

export function yForAltitude(scene: SoundingScene, altitudeM: number): number {
  return yForAltitudeOnScale(scene.scales, altitudeM);
}

export function altitudeForY(scene: SoundingScene, y: number): number {
  return altitudeForYOnScale(scene.scales, y);
}

/** Plot x for a temperature on the scene's own scale. */
export function xForTemperature(scene: SoundingScene, temperatureC: number): number {
  const { plotLeft, plotWidth, temperatureMinC, temperatureMaxC } = scene.scales;
  return (
    plotLeft + plotWidth * ((temperatureC - temperatureMinC) / (temperatureMaxC - temperatureMinC))
  );
}

/**
 * Interpolated column values at a plot y (scene px). Null when the y is
 * outside the plot; individual quantities are null where the column has no
 * data at that altitude — above the topmost published level, or a model
 * without levels at all. Interpolation is linear between published levels,
 * exactly the straight segments the chart draws.
 */
export function readingAtAltitude(scene: SoundingScene, y: number): SoundingReading | null {
  const { plotTop, plotHeight } = scene.scales;
  if (y < plotTop || y > plotTop + plotHeight) return null;
  const altitudeM = altitudeForY(scene, y);

  const temperatureC = interpolateVertical(scene.sampling.temperatureC, altitudeM);
  const dewPointC = interpolateVertical(scene.sampling.dewPointC, altitudeM);
  const uMps = interpolateVertical(scene.sampling.windU, altitudeM);
  const vMps = interpolateVertical(scene.sampling.windV, altitudeM);
  const wind = uMps === null || vMps === null ? null : componentsToWind(uMps, vMps);

  return {
    validAt: scene.validAt,
    altitudeM,
    temperatureC,
    dewPointC,
    dewPointDepressionC:
      temperatureC === null || dewPointC === null ? null : temperatureC - dewPointC,
    windSpeedMps: wind === null ? null : wind.speedMps,
    windDirectionDeg: wind === null ? null : wind.directionDeg,
    parcelTempC: interpolateVertical(scene.sampling.parcelTempC, altitudeM),
    buoyancyC: interpolateVertical(scene.sampling.buoyancyC, altitudeM),
  };
}
