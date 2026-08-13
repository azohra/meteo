import type { ForecastHour } from "../../contract.js";
import { p50 } from "../../derive/ensemble.js";
import { componentsToWind, windToComponents } from "../../derive/wind.js";
import type { ThermalWindowFinding } from "./thermal-window.js";
import { round2, type CitedInstant, type Context, type LocalDayKey } from "./shared.js";

/**
 * Surface-flow evolution across one thermalWindow: direction and speed
 * at the window's start, peak-lift hour, and end, the net circular veer
 * between the endpoints, and the vector-mean surface and climb-band
 * directions. Deterministic documents only — published ensemble
 * direction percentiles are not circular statistics; all direction
 * arithmetic is vector math, raw degrees are never averaged, and any
 * sample or mean whose speed sits under `directionFloorMps` states a
 * null direction.
 */
export interface WindDirectionFinding {
  kind: "windDirection";
  day: LocalDayKey;
  window: { start: CitedInstant; end: CitedInstant };
  surface: {
    /** Direction null under the floor (or unpublished); speed always. */
    start: { directionDeg: number | null; speedMps: number };
    peakLift: { directionDeg: number | null; speedMps: number; at: CitedInstant };
    end: { directionDeg: number | null; speedMps: number };
  };
  /** Circular start→end veer, positive clockwise; null when either endpoint's direction is suppressed. Never cumulative rotation, and blind to a full 360° loop by construction. */
  netVeerDeg: number | null;
  surfaceVectorMean: { directionDeg: number | null; speedMps: number };
  /** Vector mean over every in-band level sample (launch to lift top) across the window's hours; null when the column offers none. */
  bandVectorMean: {
    directionDeg: number | null;
    speedMps: number;
    samples: number;
  } | null;
  thresholds: { directionFloorMps: number };
  /** The raw published surface series over the window hours that publish both speed and direction — the path behind the net displacement. */
  evidence: { hours: string[]; surfaceDirectionDeg: number[]; surfaceSpeedMps: number[] };
}

/** Signed smallest-angle rotation from one bearing to another, (-180, 180]. */
function signedVeerDeg(fromDeg: number, toDeg: number): number {
  let delta = (toDeg - fromDeg) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

export function findWindDirection(
  context: Context,
  windows: ThermalWindowFinding[],
): WindDirectionFinding[] {
  if (!context.deterministic) return [];
  const { profile, launchReferenceM, thresholds } = context;
  const { directionFloorMps } = thresholds.windDirection;
  const hourByValidAt = new Map(profile.hours.map((hour) => [hour.validAt, hour]));

  const surfaceAt = (
    hour: ForecastHour,
  ): { speedMps: number; directionDeg: number | null } | null => {
    const speedMps = p50(hour.surface.windSpeedMps);
    if (speedMps === null) return null;
    return { speedMps, directionDeg: p50(hour.surface.windDirectionDeg) };
  };
  const sampleOf = (raw: { speedMps: number; directionDeg: number | null }) => ({
    directionDeg:
      raw.directionDeg !== null && raw.speedMps >= directionFloorMps
        ? Math.round(raw.directionDeg)
        : null,
    speedMps: round2(raw.speedMps),
  });

  const findings: WindDirectionFinding[] = [];
  for (const window of windows) {
    const hours = window.evidence.hours.map((validAt) => hourByValidAt.get(validAt)!);
    const start = surfaceAt(hours[0]);
    const end = surfaceAt(hours[hours.length - 1]);
    const peak = surfaceAt(hourByValidAt.get(window.peakLiftTopAt.validAt)!);
    if (start === null || end === null || peak === null) continue;

    let uSum = 0;
    let vSum = 0;
    const evidence: WindDirectionFinding["evidence"] = {
      hours: [],
      surfaceDirectionDeg: [],
      surfaceSpeedMps: [],
    };
    for (const hour of hours) {
      const raw = surfaceAt(hour);
      if (raw === null || raw.directionDeg === null) continue;
      const { uMps, vMps } = windToComponents(raw.speedMps, raw.directionDeg);
      uSum += uMps;
      vSum += vMps;
      evidence.hours.push(hour.validAt);
      evidence.surfaceDirectionDeg.push(Math.round(raw.directionDeg));
      evidence.surfaceSpeedMps.push(round2(raw.speedMps));
    }
    if (evidence.hours.length === 0) continue;
    const surfaceMean = componentsToWind(
      uSum / evidence.hours.length,
      vSum / evidence.hours.length,
    );

    let bandU = 0;
    let bandV = 0;
    let bandSamples = 0;
    for (const hour of hours) {
      const top = p50(hour.derived.usableLiftTopM);
      if (top === null) continue;
      for (const level of hour.levels) {
        const heightM = p50(level.heightM);
        const speedMps = p50(level.windSpeedMps);
        const directionDeg = p50(level.windDirectionDeg);
        if (heightM === null || speedMps === null || directionDeg === null) continue;
        if (heightM < launchReferenceM || heightM > top) continue;
        const { uMps, vMps } = windToComponents(speedMps, directionDeg);
        bandU += uMps;
        bandV += vMps;
        bandSamples += 1;
      }
    }
    const bandMean =
      bandSamples > 0 ? componentsToWind(bandU / bandSamples, bandV / bandSamples) : null;

    const startSample = sampleOf(start);
    const endSample = sampleOf(end);
    findings.push({
      kind: "windDirection",
      day: window.day,
      window: { start: window.start, end: window.end },
      surface: {
        start: startSample,
        peakLift: { ...sampleOf(peak), at: window.peakLiftTopAt },
        end: endSample,
      },
      netVeerDeg:
        startSample.directionDeg !== null && endSample.directionDeg !== null
          ? Math.round(signedVeerDeg(start.directionDeg!, end.directionDeg!))
          : null,
      surfaceVectorMean: {
        directionDeg:
          surfaceMean.speedMps >= directionFloorMps ? Math.round(surfaceMean.directionDeg) : null,
        speedMps: round2(surfaceMean.speedMps),
      },
      bandVectorMean:
        bandMean === null
          ? null
          : {
              directionDeg:
                bandMean.speedMps >= directionFloorMps ? Math.round(bandMean.directionDeg) : null,
              speedMps: round2(bandMean.speedMps),
              samples: bandSamples,
            },
      thresholds: { directionFloorMps },
      evidence,
    });
  }
  return findings;
}
