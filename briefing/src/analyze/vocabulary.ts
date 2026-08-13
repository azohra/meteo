import type { SmokeDocument } from "../contract.js";
import type { AnalysisExtension } from "./frame.js";
import type { LocalDayKey } from "./kinds/shared.js";
import type { BandShearFinding } from "./kinds/band-shear.js";
import type { CapTimingFinding } from "./kinds/cap-timing.js";
import type { ConvectiveDayFinding } from "./kinds/convective-day.js";
import type { DataCaveatsFinding } from "./kinds/data-caveats.js";
import type { EnsembleMembershipFinding } from "./kinds/ensemble-membership.js";
import type { ThermalWindowFinding } from "./kinds/thermal-window.js";
import type { LiftCeilingFinding } from "./kinds/lift-ceiling.js";
import type { PercentileCrossingFinding } from "./kinds/percentile-crossing.js";
import type { QuietDayFinding } from "./kinds/quiet-day.js";
import type { SmokeImpactFinding } from "./kinds/smoke-impact.js";
import type { TerrainMismatchFinding } from "./kinds/terrain-mismatch.js";
import type { WindDirectionFinding } from "./kinds/wind-direction.js";
import type { WindExceedanceFinding } from "./kinds/wind-exceedance.js";
import type { WindSummaryFinding } from "./kinds/wind-summary.js";

/** The version of the finding-kind set this module emits; consumers switch on `kind`, and changing the set is a contract event. */
export const ANALYZE_VOCABULARY_VERSION = 5;

export type { CitedInstant, LocalDayKey } from "./kinds/shared.js";

export type { BandShearFinding } from "./kinds/band-shear.js";
export type { CapTimingFinding } from "./kinds/cap-timing.js";
export type { ConvectiveDayFinding } from "./kinds/convective-day.js";
export type { DataCaveat, DataCaveatsFinding } from "./kinds/data-caveats.js";
export type { EnsembleMembershipFinding } from "./kinds/ensemble-membership.js";
export type { ThermalWindowFinding } from "./kinds/thermal-window.js";
export type { LiftCeilingFinding } from "./kinds/lift-ceiling.js";
export type { PercentileCrossingFinding, PercentileToken } from "./kinds/percentile-crossing.js";
export type { QuietDayFinding } from "./kinds/quiet-day.js";
export type {
  SmokeImpactFinding,
  SmokeImpactJoinedFinding,
  SmokeImpactProfileFinding,
} from "./kinds/smoke-impact.js";
export type { TerrainMismatchFinding } from "./kinds/terrain-mismatch.js";
export type { WindDirectionFinding } from "./kinds/wind-direction.js";
export type { WindExceedanceFinding } from "./kinds/wind-exceedance.js";
export type { WindSummaryFinding } from "./kinds/wind-summary.js";

export type ForecastFinding =
  | TerrainMismatchFinding
  | DataCaveatsFinding
  | EnsembleMembershipFinding
  | CapTimingFinding
  | ConvectiveDayFinding
  | ThermalWindowFinding
  | PercentileCrossingFinding
  | QuietDayFinding
  | LiftCeilingFinding
  | SmokeImpactFinding
  | WindSummaryFinding
  | WindExceedanceFinding
  | WindDirectionFinding
  | BandShearFinding;

export type FindingKind = ForecastFinding["kind"];

/**
 * Resolved thresholds — an output/echo type (`resolveAnalyzeThresholds`'s
 * return and every finding's `thresholds` echo). Never construct one:
 * pass `AnalyzeThresholdOverrides` and let the defaults fill.
 */
export interface AnalyzeThresholds {
  thermalWindow: { wstarMinMps: number; depthMinM: number; maxGapHours: number };
  liftCeiling: { cloudCapMarginM: number };
  capTiming: {
    instabilityMinCapeJkg: number;
    brokenCapMaxAbsCinJkg: number;
    brokenCapMinCapeJkg: number;
    precipMinMmHr: number;
  };
  convectiveDay: { precipMinMmHr: number };
  terrainMismatch: { minAbsDeltaM: number };
  windSummary: { bandMarginM: number; persistenceFractionOfMax: number };
  windDirection: { directionFloorMps: number };
  bandShear: { minLayerThicknessM: number; endpointFloorMps: number };
}

/** The default thresholds, embedded in every finding they shaped — conventions, not physics, and caller-movable per call. */
export const DEFAULT_ANALYZE_THRESHOLDS: AnalyzeThresholds = {
  thermalWindow: { wstarMinMps: 0.9, depthMinM: 300, maxGapHours: 0 },
  liftCeiling: { cloudCapMarginM: 50 },
  capTiming: {
    instabilityMinCapeJkg: 100,
    brokenCapMaxAbsCinJkg: 25,
    brokenCapMinCapeJkg: 200,
    precipMinMmHr: 0.2,
  },
  convectiveDay: { precipMinMmHr: 0.2 },
  terrainMismatch: { minAbsDeltaM: 250 },
  windSummary: { bandMarginM: 200, persistenceFractionOfMax: 0.8 },
  windDirection: { directionFloorMps: 1 },
  bandShear: { minLayerThicknessM: 30, endpointFloorMps: 2 },
};

/** Per-kind threshold overrides: each kind's block merges over its default, so a caller may move one number without restating the rest. */
export type AnalyzeThresholdOverrides = {
  [K in keyof AnalyzeThresholds]?: Partial<AnalyzeThresholds[K]>;
};

export interface AnalyzeOptions {
  /** IANA timezone for every local field; defaults to the document's own `site.timeZone`, else UTC with a `timesAreUtc` caveat. */
  timeZone?: string;
  /** The launch the analysis reads launch-relative statements against — an analysis input, since documents are launch-agnostic; absent, launch-relative arithmetic falls back to the model's own ground and `terrainMismatch` is never emitted. */
  launch?: { elevationM: number } | null;
  /** Per-kind threshold overrides, merged over the defaults per kind. */
  thresholds?: AnalyzeThresholdOverrides;
  /** A same-site smoke document to join by validAt for smoke-blind profiles; ignored when the profile carries its own `hours[].smoke`. */
  smoke?: SmokeDocument | null;
  /** Caller-owned wind ceilings for `windExceedance` — deliberately not in `thresholds`, because no defaults exist: the package never owns a "safe wind" number, and without a ceiling the kind emits nothing. */
  windCeilings?: WindCeilings;
  /** Caller extractors run over the public `AnalysisFrame` after the built-in findings; their statements land on the envelope's `extensions` array, never in `findings`. Duplicate names in one call throw. */
  extensions?: ReadonlyArray<AnalysisExtension>;
}

/** See `AnalyzeOptions.windCeilings` — caller conventions, no defaults. */
export interface WindCeilings {
  surfaceMps?: number;
  /** Per gust-semantics class; a document only reads the ceiling matching its own declared `semantics.gust`. */
  gust?: { hourMaxMps?: number; instantMps?: number };
  bandMps?: number;
}

export interface ForecastAnalysis {
  /** The vocabulary version that produced this envelope — typed `number` under the tolerant-reader convention: readers ignore kinds and fields they do not know and check the version at runtime. */
  vocabularyVersion: number;
  model: string;
  /** Whether the document is deterministic or an ensemble read at p50 — precomputed so envelope consumers never re-open the profile. */
  deterministic: boolean;
  /** The document's sample identity plus the launch the analysis ran against; `launchAltitudeM` is null when none was supplied. */
  site: { id: string; launchAltitudeM: number | null; modelElevationM: number };
  run: { referenceTime: string };
  /** The timezone every local field below reads in. */
  timeZone: string;
  timeZoneSource: "document" | "override" | "utcFallback";
  /** The document's leading cadence (its first two hours' gap) — a display fact, not a document-wide constant: live documents widen mid-horizon. */
  stepHours: number;
  hours: number;
  /** The local calendar days the document's hours actually touch (sorted, computed in this envelope's own `timeZone` from `hours[].validAt`, never cadence arithmetic). */
  coveredDays: LocalDayKey[];
  /** The resolved thresholds this analysis ran under, echoed at the top level so a comparison can validate coherence. */
  thresholds: AnalyzeThresholds;
  findings: ForecastFinding[];
  /** Named third-party statements (`AnalyzeOptions.extensions`), kept out of `findings`; absent (not empty) when no extensions were passed. */
  extensions?: ReadonlyArray<{ extension: string; statements: unknown[] }>;
}
