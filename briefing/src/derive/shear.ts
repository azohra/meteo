import { windToComponents, type WindComponents } from "./wind.js";

export interface WindSample {
  windSpeedMps: number;
  windDirectionDeg: number;
}

/**
 * Vector wind shear (m/s) between two samples: the magnitude of the
 * component-wise wind difference, |V_upper − V_lower|. Identical winds shear
 * zero; equal speeds from opposite directions shear twice the speed.
 */
export function vectorShearMps(lower: WindSample, upper: WindSample): number {
  const a = windToComponents(lower.windSpeedMps, lower.windDirectionDeg);
  const b = windToComponents(upper.windSpeedMps, upper.windDirectionDeg);
  return Math.hypot(b.uMps - a.uMps, b.vMps - a.vMps);
}

/**
 * Surface-to-boundary-layer-top vector shear (m/s) for one profile hour:
 * the 10 m wind against the wind interpolated at the published
 * boundaryLayerTopM (null without a boundary layer or levels; a BL top
 * above the highest level uses that level's wind). Assumes both winds
 * sample the same air mass, which fails structurally in mountain valleys
 * where the 10 m wind is decoupled thermal circulation — terrain-driven
 * sites should read the height-resolved windShear field instead.
 */
export function surfaceToBoundaryLayerShearMps(args: {
  surfaceWind: WindSample;
  modelElevationM: number;
  boundaryLayerTopM: number | null;
  levels: ReadonlyArray<WindSample & { heightM: number }>;
}): number | null {
  if (args.boundaryLayerTopM === null || args.levels.length === 0) return null;

  const surface = windToComponents(
    args.surfaceWind.windSpeedMps,
    args.surfaceWind.windDirectionDeg,
  );
  const nodes: Array<{ heightM: number; components: WindComponents }> = [
    { heightM: args.modelElevationM, components: surface },
    ...[...args.levels]
      .sort((left, right) => left.heightM - right.heightM)
      .map((level) => ({
        heightM: level.heightM,
        components: windToComponents(level.windSpeedMps, level.windDirectionDeg),
      })),
  ];

  const top = interpolateComponents(nodes, args.boundaryLayerTopM);
  return Math.hypot(top.uMps - surface.uMps, top.vMps - surface.vMps);
}

/**
 * Buoyancy/shear ratio, dimensionless: w* ÷ surfaceToBoundaryLayerShearMps.
 * Zero shear returns Infinity, except 0/0 which returns null. Inherits the
 * shear term's same-air-mass assumption and fails structurally at mountain
 * sites, where valley circulation pins the ratio low on the best days.
 */
export function buoyancyShearRatio(
  thermalVelocityMps: number,
  boundaryLayerShearMps: number,
): number | null {
  if (boundaryLayerShearMps === 0) {
    return thermalVelocityMps === 0 ? null : Number.POSITIVE_INFINITY;
  }
  return thermalVelocityMps / boundaryLayerShearMps;
}

function interpolateComponents(
  nodes: Array<{ heightM: number; components: WindComponents }>,
  heightM: number,
): WindComponents {
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (heightM <= first.heightM) return first.components;
  if (heightM >= last.heightM) return last.components;

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const lower = nodes[index];
    const upper = nodes[index + 1];
    if (heightM > upper.heightM) continue;
    const fraction = (heightM - lower.heightM) / Math.max(0.001, upper.heightM - lower.heightM);
    return {
      uMps: lower.components.uMps + (upper.components.uMps - lower.components.uMps) * fraction,
      vMps: lower.components.vMps + (upper.components.vMps - lower.components.vMps) * fraction,
    };
  }
  return last.components;
}
