import { isEnsembleValue } from "../../contract.js";
import { p50 } from "../../derive/ensemble.js";
import { round1, type CitedInstant, type Context } from "./shared.js";

/**
 * The model's grid terrain sits far from the launch, so every
 * altitude-referenced series in the document is structurally biased. The
 * one verdict, `liftTopEverReachesLaunch`, is pure arithmetic; emitted
 * only when a launch is supplied and |delta| is at least
 * `thresholds.minAbsDeltaM`.
 */
export interface TerrainMismatchFinding {
  kind: "terrainMismatch";
  modelElevationM: number;
  /** The caller-supplied launch elevation (AnalyzeOptions.launch), metres MSL. */
  siteAltitudeM: number;
  /** modelElevationM − siteAltitudeM; negative = model terrain below launch. */
  deltaM: number;
  /** Arithmetic verdict: does any hour's published lift top exceed launch? */
  liftTopEverReachesLaunch: boolean;
  thresholds: { minAbsDeltaM: number };
  evidence: {
    maxUsableLiftTopM: number | null;
    maxUsableLiftTopAt: CitedInstant | null;
    /** The max published p90 lift top — ensemble documents only, null for deterministic ones — so the bench is checkable against the band's top, not only the median the verdict reads. */
    maxUsableLiftTopP90M: number | null;
  };
}

export function findTerrainMismatch(context: Context): TerrainMismatchFinding[] {
  const { profile, thresholds } = context;
  const launch = context.launchElevationM;
  if (launch === null) return [];
  const delta = profile.site.modelElevationM - launch;
  if (Math.abs(delta) < thresholds.terrainMismatch.minAbsDeltaM) return [];

  let maxTop: number | null = null;
  let maxTopAt: CitedInstant | null = null;
  let maxTopP90: number | null = null;
  for (const hour of profile.hours) {
    const value = hour.derived.usableLiftTopM;
    const top = p50(value);
    if (top !== null && (maxTop === null || top > maxTop)) {
      maxTop = top;
      maxTopAt = context.cite(hour.validAt);
    }
    if (value !== null && isEnsembleValue(value) && value.p90 !== null) {
      if (maxTopP90 === null || value.p90 > maxTopP90) maxTopP90 = value.p90;
    }
  }
  return [
    {
      kind: "terrainMismatch",
      modelElevationM: profile.site.modelElevationM,
      siteAltitudeM: launch,
      deltaM: round1(delta),
      liftTopEverReachesLaunch: maxTop !== null && maxTop > launch,
      thresholds: { ...thresholds.terrainMismatch },
      evidence: {
        maxUsableLiftTopM: maxTop === null ? null : round1(maxTop),
        maxUsableLiftTopAt: maxTopAt,
        maxUsableLiftTopP90M: maxTopP90 === null ? null : round1(maxTopP90),
      },
    },
  ];
}
