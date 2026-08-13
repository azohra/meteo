import { isDeterministicProfile, type SiteForecast } from "../contract.js";
import { localDateKey } from "../derive/day-window.js";
import type { AnalysisFrame } from "./frame.js";
import { findBandShear } from "./kinds/band-shear.js";
import { findCapTiming } from "./kinds/cap-timing.js";
import { findConvectiveDays } from "./kinds/convective-day.js";
import { findDataCaveats } from "./kinds/data-caveats.js";
import { findEnsembleMembership } from "./kinds/ensemble-membership.js";
import { findThermalWindows } from "./kinds/thermal-window.js";
import { findLiftCeilings } from "./kinds/lift-ceiling.js";
import { findPercentileCrossings } from "./kinds/percentile-crossing.js";
import { findQuietDays } from "./kinds/quiet-day.js";
import {
  citedInstantFactory,
  hourStepsOf,
  leadHoursTo,
  stepHoursOf,
  type Context,
} from "./kinds/shared.js";
import { findSmokeImpact } from "./kinds/smoke-impact.js";
import { findTerrainMismatch } from "./kinds/terrain-mismatch.js";
import { findWindDirection } from "./kinds/wind-direction.js";
import { findWindExceedance } from "./kinds/wind-exceedance.js";
import { findWindSummaries } from "./kinds/wind-summary.js";
import {
  ANALYZE_VOCABULARY_VERSION,
  DEFAULT_ANALYZE_THRESHOLDS,
  type AnalyzeOptions,
  type AnalyzeThresholdOverrides,
  type AnalyzeThresholds,
  type ForecastAnalysis,
  type ForecastFinding,
} from "./vocabulary.js";

/**
 * Extracts the versioned vocabulary's findings from one profile document;
 * ensemble positions are read at p50.
 */
export function analyzeForecast(
  profile: SiteForecast,
  options: AnalyzeOptions = {},
): ForecastAnalysis {
  const thresholds = mergeThresholds(options.thresholds);
  const timeZoneSource: ForecastAnalysis["timeZoneSource"] = options.timeZone
    ? "override"
    : profile.site.timeZone
      ? "document"
      : "utcFallback";
  const timeZone = options.timeZone ?? profile.site.timeZone ?? "UTC";
  const launchElevationM = options.launch?.elevationM ?? null;
  const context: Context = {
    profile,
    timeZone,
    deterministic: isDeterministicProfile(profile),
    stepHours: stepHoursOf(profile),
    steps: hourStepsOf(profile),
    launchElevationM,
    launchReferenceM: launchElevationM ?? profile.site.modelElevationM,
    cite: citedInstantFactory(timeZone),
    thresholds,
    ...(options.windCeilings ? { windCeilings: options.windCeilings } : {}),
  };

  const windows = findThermalWindows(context);
  const smokeImpacts = findSmokeImpact(context, windows, options.smoke ?? null);
  const findings: ForecastFinding[] = [
    ...findTerrainMismatch(context),
    ...windows,
    ...findPercentileCrossings(context),
    ...findQuietDays(context, windows),
    ...findLiftCeilings(context, windows),
    ...findCapTiming(context, windows),
    ...findConvectiveDays(context, windows),
    ...smokeImpacts,
    ...findWindSummaries(context, windows),
    ...findWindExceedance(context, windows),
    ...findWindDirection(context, windows),
    ...findBandShear(context, windows),
    ...findEnsembleMembership(context),
    findDataCaveats(context, timeZoneSource, smokeImpacts.length > 0),
  ];

  let extensions: Array<{ extension: string; statements: unknown[] }> | undefined;
  if (options.extensions && options.extensions.length > 0) {
    const names = new Set<string>();
    for (const extension of options.extensions) {
      if (names.has(extension.name)) {
        throw new Error(
          `analyzeForecast: duplicate extension name (${extension.name}) — entries are keyed by name, so each extension in one call needs its own`,
        );
      }
      names.add(extension.name);
    }
    const frame: AnalysisFrame = {
      profile,
      timeZone,
      timeZoneSource,
      deterministic: context.deterministic,
      stepHours: context.stepHours,
      steps: context.steps,
      referenceTime: profile.run.referenceTime,
      launchElevationM,
      launchReferenceM: context.launchReferenceM,
      cite: context.cite,
      dayOf: (validAt) => localDateKey(validAt, timeZone),
      leadHours: (validAt) => leadHoursTo(profile.run.referenceTime, validAt),
    };
    extensions = options.extensions.map((extension) => ({
      extension: extension.name,
      statements: extension.extract(frame, findings),
    }));
  }

  return {
    vocabularyVersion: ANALYZE_VOCABULARY_VERSION,
    model: profile.model,
    deterministic: context.deterministic,
    site: {
      id: profile.site.id,
      launchAltitudeM: launchElevationM,
      modelElevationM: profile.site.modelElevationM,
    },
    run: { referenceTime: profile.run.referenceTime },
    timeZone,
    timeZoneSource,
    stepHours: context.stepHours,
    hours: profile.hours.length,
    coveredDays: [
      ...new Set(profile.hours.map((hour) => localDateKey(hour.validAt, timeZone))),
    ].sort(),
    thresholds,
    findings,
    ...(extensions ? { extensions } : {}),
  };
}

/** The exact per-kind merge `analyzeForecast` applies to its `thresholds` option. */
export function resolveAnalyzeThresholds(overrides?: AnalyzeThresholdOverrides): AnalyzeThresholds {
  return mergeThresholds(overrides);
}

function mergeThresholds(overrides?: AnalyzeThresholdOverrides): AnalyzeThresholds {
  if (!overrides) return DEFAULT_ANALYZE_THRESHOLDS;
  return {
    thermalWindow: { ...DEFAULT_ANALYZE_THRESHOLDS.thermalWindow, ...overrides.thermalWindow },
    liftCeiling: { ...DEFAULT_ANALYZE_THRESHOLDS.liftCeiling, ...overrides.liftCeiling },
    capTiming: { ...DEFAULT_ANALYZE_THRESHOLDS.capTiming, ...overrides.capTiming },
    convectiveDay: { ...DEFAULT_ANALYZE_THRESHOLDS.convectiveDay, ...overrides.convectiveDay },
    terrainMismatch: {
      ...DEFAULT_ANALYZE_THRESHOLDS.terrainMismatch,
      ...overrides.terrainMismatch,
    },
    windSummary: { ...DEFAULT_ANALYZE_THRESHOLDS.windSummary, ...overrides.windSummary },
    windDirection: { ...DEFAULT_ANALYZE_THRESHOLDS.windDirection, ...overrides.windDirection },
    bandShear: { ...DEFAULT_ANALYZE_THRESHOLDS.bandShear, ...overrides.bandShear },
  };
}
