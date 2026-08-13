export interface UsableLiftInputs {
  /** site.modelElevationM from the profile document. */
  modelElevationM: number;
  /** derived.boundaryLayerTopM (MSL); null when the hour has no boundary layer. */
  boundaryLayerTopM: number | null;
  /** derived.thermalVelocityMps (W*). */
  thermalVelocityMps: number;
  /** derived.cloudBaseM (MSL). */
  cloudBaseM: number;
  /** hours[].levels — only heightM is read; must be ascending like the document. */
  levels: ReadonlyArray<{ heightM: number }>;
}

/**
 * Height (MSL, metres) to which a pilot sinking at `sinkRateMps` can still
 * climb, or null when the strongest core never beats the sink rate. The
 * default 1.0 m/s reproduces the forecast engine's published usableLiftTopM; other
 * sink rates answer "what about my glider?" without republishing anything.
 */
export function usableLiftTopM(inputs: UsableLiftInputs, sinkRateMps = 1.0): number | null {
  const { modelElevationM, boundaryLayerTopM, thermalVelocityMps, cloudBaseM, levels } = inputs;
  if (boundaryLayerTopM === null) return null;
  const boundaryLayerDepthM = boundaryLayerTopM - modelElevationM;
  if (boundaryLayerDepthM <= 0 || thermalVelocityMps * 2.02 < sinkRateMps) return null;

  let previousAltitudeAglM = boundaryLayerDepthM * 0.2;
  let previousUpdraftMps = thermalVelocityMps * 1.97;

  for (const level of levels) {
    const altitudeAglM = level.heightM - modelElevationM;
    if (altitudeAglM < boundaryLayerDepthM * 0.25) continue;
    if (level.heightM >= cloudBaseM) return cloudBaseM;

    const normalizedHeight = altitudeAglM / boundaryLayerDepthM;
    const updraftMps =
      thermalVelocityMps *
      4 *
      Math.cbrt(Math.max(0, normalizedHeight)) *
      (1 - 0.8 * normalizedHeight);
    if (updraftMps <= sinkRateMps) {
      const fraction = clamp(
        (sinkRateMps - previousUpdraftMps) / (updraftMps - previousUpdraftMps),
        0,
        1,
      );
      return Math.min(
        cloudBaseM,
        modelElevationM + previousAltitudeAglM + fraction * (altitudeAglM - previousAltitudeAglM),
      );
    }
    previousAltitudeAglM = altitudeAglM;
    previousUpdraftMps = updraftMps;
  }

  return Math.min(cloudBaseM, modelElevationM + boundaryLayerDepthM);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
