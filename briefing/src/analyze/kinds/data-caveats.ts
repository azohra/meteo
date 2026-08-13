import { p50 } from "../../derive/ensemble.js";
import type { Context } from "./shared.js";

/** One entry in the dataCaveats honesty layer — all threshold-free. */
export type DataCaveat =
  | {
      /** Quantity families never published in this document — absence means "not published", never zero; the `"smoke"` token means no smoke block and no joined smoke statement, so no finding in the analysis accounts for smoke. */
      caveat: "absentQuantities";
      quantities: string[];
    }
  | {
      /** Hours where a derived nullable series is null — a real forecast of "none", not a gap. */
      caveat: "derivedNullHours";
      quantity: "usableLiftTopM" | "boundaryLayerTopM";
      hoursNull: number;
      ofHours: number;
    }
  | {
      /** Multi-hour steps: timing finer than the cadence is interpolation, not forecast; `stepHours` is the document's widest adjacent gap. */
      caveat: "stepCadence";
      stepHours: number;
    }
  | {
      /** The document declares no site.timeZone and no override was given,
       * so every local field in this analysis reads in UTC. */
      caveat: "timesAreUtc";
    };

/**
 * What this document cannot say: quantity families it never publishes,
 * derived-null hours, cadence-interpolation notes. Threshold-free by
 * definition — these are declarations, not judgments.
 */
export interface DataCaveatsFinding {
  kind: "dataCaveats";
  caveats: DataCaveat[];
}

export function findDataCaveats(
  context: Context,
  timeZoneSource: "document" | "override" | "utcFallback",
  /** Whether any smokeImpact finding was emitted — a supplied smoke document that never matches still leaves the analysis smoke-blind. */
  smokeStated: boolean,
): DataCaveatsFinding {
  const { profile } = context;
  const caveats: DataCaveat[] = [];

  const surfaceFamilies = [
    "windGustMps",
    "capeJkg",
    "cinJkg",
    "pblHeightM",
    "lowCloudPercent",
    "midCloudPercent",
    "highCloudPercent",
  ] as const;
  const absent: string[] = [];
  for (const family of surfaceFamilies) {
    if (profile.hours.every((hour) => hour.surface[family] === undefined)) absent.push(family);
  }
  if (profile.hours.every((hour) => hour.levels.length === 0)) {
    absent.push("levels");
  } else {
    if (
      profile.hours.every((hour) =>
        hour.levels.every((level) => level.verticalVelocityPaS === undefined),
      )
    ) {
      absent.push("levels[].verticalVelocityPaS");
    }
    if (
      profile.hours.every((hour) =>
        hour.levels.every((level) => level.cloudFractionPercent === undefined),
      )
    ) {
      absent.push("levels[].cloudFractionPercent");
    }
  }
  if (!smokeStated && profile.hours.every((hour) => hour.smoke === undefined)) {
    absent.push("smoke");
  }
  if (absent.length > 0) caveats.push({ caveat: "absentQuantities", quantities: absent });

  for (const quantity of ["usableLiftTopM", "boundaryLayerTopM"] as const) {
    const hoursNull = profile.hours.filter((hour) => p50(hour.derived[quantity]) === null).length;
    if (hoursNull > 0) {
      caveats.push({
        caveat: "derivedNullHours",
        quantity,
        hoursNull,
        ofHours: profile.hours.length,
      });
    }
  }

  if (context.steps.maxStepHours > 1) {
    caveats.push({ caveat: "stepCadence", stepHours: context.steps.maxStepHours });
  }
  if (timeZoneSource === "utcFallback") caveats.push({ caveat: "timesAreUtc" });

  return { kind: "dataCaveats", caveats };
}
