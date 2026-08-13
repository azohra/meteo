import type { SiteForecast } from "../contract.js";
import type { CitedInstant, HourSteps, LocalDayKey } from "./kinds/shared.js";
import type { ForecastFinding } from "./vocabulary.js";

export { round1, round2 } from "./kinds/shared.js";
export type { HourSteps } from "./kinds/shared.js";

/** The frame's own version, separate from the vocabulary's: the frame is where extractors stand, the vocabulary is what they say. */
export const ANALYSIS_FRAME_VERSION = 1;

/**
 * The extraction frame — the resolved per-analysis facts and the
 * citation/day/lead conventions every extractor reads, handed to each
 * `AnalysisExtension`; the raw hour data stays available through
 * `profile`.
 */
export interface AnalysisFrame {
  readonly profile: SiteForecast;
  readonly timeZone: string;
  readonly timeZoneSource: "document" | "override" | "utcFallback";
  readonly deterministic: boolean;
  /** Leading cadence — a display fact, never arithmetic: live documents widen mid-horizon, so spacing arithmetic reads `steps`. */
  readonly stepHours: number;
  /** Per-gap cadence truth, covered-span convention (see `HourSteps`). */
  readonly steps: HourSteps;
  readonly referenceTime: string;
  /** The caller's launch (`AnalyzeOptions.launch`); null when none was supplied. */
  readonly launchElevationM: number | null;
  /** launchElevationM, falling back to the model's own ground. */
  readonly launchReferenceM: number;
  /** Citation, day bucketing, and lead, bound to this analysis's zone and run. */
  cite(validAt: string): CitedInstant;
  dayOf(validAt: string): LocalDayKey;
  leadHours(validAt: string): number;
}

/**
 * A caller-supplied extractor run over the frame after first-party
 * extraction; its statements land on the envelope as a named `extensions`
 * entry, never in `findings`, and a throwing extension fails the
 * analysis.
 */
export interface AnalysisExtension {
  /** Namespaced, echoed verbatim on the envelope entry (e.g. "acrophobia/ridgeDay"); duplicate names in one call throw. */
  name: string;
  extract(frame: AnalysisFrame, findings: ReadonlyArray<ForecastFinding>): unknown[];
}
