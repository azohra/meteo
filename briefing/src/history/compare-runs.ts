import type { SiteForecast } from "../contract.js";
import { localDateKey, localInstantMs } from "../derive/day-window.js";
import {
  analyzeForecast,
  round1,
  type AnalyzeThresholdOverrides,
  type AnalyzeThresholds,
  type EnsembleMembershipFinding,
  type LocalDayKey,
  type ForecastAnalysis,
} from "../analyze/index.js";
import {
  compareAnalyses,
  nearestTo,
  type Abstention,
  type ComparisonMemberLedger,
  type QuietVote,
  type TimingVote,
  type WindowAgreementFinding,
  type WindowVote,
} from "../compare.js";
import type { HistoryRevision } from "./index.js";

/** The version of the run-comparison kind set this module emits — a sibling of `COMPARE_VOCABULARY_VERSION`, versioned independently. */
export const RUN_COMPARISON_VOCABULARY_VERSION = 2;

/** `settled`'s embedded defaults, caller-movable per call (`CompareRunsOptions.settled`). */
export const DEFAULT_SETTLED_THRESHOLDS = { minRuns: 3, magnitudeBandM: 300 } as const;

/** The lead anchor's default local hour: the target day's local noon in the comparison's one timeZone. */
export const DEFAULT_LEAD_ANCHOR_LOCAL_HOUR = 12;

/**
 * One run's rung on a day's existence ladder: what the run said about
 * the target day — window, quiet, or an abstention with its reason —
 * with the run's own sensitivity flip values carried through. Benched
 * runs appear on no rung.
 */
export interface ExistenceRung {
  /** The run's member key (`"{model}@{referenceTime}"`) — joins the envelope's `runs` ledger and `analyses` record. */
  member: string;
  referenceTime: string;
  /** Hours from this run's referenceTime to the target day's anchor instant; negative when the anchor precedes the run. */
  leadHours: number;
  vote: "window" | "quiet" | "abstained";
  /** The stated non-vote reason, present exactly when `vote` is "abstained". */
  abstained?: Abstention["reason"];
  /** The quiet vote's failed floors, present exactly when `vote` is "quiet". */
  failed?: QuietVote["failed"];
  /** The run's own flip values against the shared floors — windowAgreement's `sensitivity` per run; an abstained rung offers nothing (null). */
  sensitivity: { wstarFlipAtMps: number | null; depthFlipAtM: number | null };
}

/**
 * Per target local day: run-by-run window/quiet/abstain votes, newest
 * run first. An existence flip is read off the `vote` sequence; the
 * finding never names it with an adjective.
 */
export interface ExistenceTrajectoryFinding {
  kind: "existenceTrajectory";
  day: LocalDayKey;
  rungs: ReadonlyArray<ExistenceRung>;
  /** The floors every rung's vote and sensitivity read against. */
  thresholds: { wstarMinMps: number; depthMinM: number };
}

/** A run's unclipped window edge on the target day: compare's TimingVote plus the run axis. */
export interface RunTimingVote extends TimingVote {
  referenceTime: string;
  /** See ExistenceRung.leadHours. */
  leadHours: number;
}

/**
 * Per target local day: window start/end instants across runs, newest
 * run first, reusing compare's timing construction verbatim — only
 * unclipped edges vote, an edge joins the day containing its instant,
 * and every vote carries its window's `stepHours` quantization bound.
 * The reader sees the series; the finding draws no trend.
 */
export interface TimingTrajectoryFinding {
  kind: "timingTrajectory";
  day: LocalDayKey;
  starts: ReadonlyArray<RunTimingVote>;
  ends: ReadonlyArray<RunTimingVote>;
  startSpreadHours: number | null;
  /** Widest stepHours among `starts`; null when `starts` is empty. */
  startStepHoursMax: number | null;
  endSpreadHours: number | null;
  endStepHoursMax: number | null;
}

/**
 * One run's magnitudes for the target day: window rungs read only the
 * windows keyed to this day (a via-only run states null rather than
 * restating another day's magnitudes), the launch-relative peak joins
 * the day its instant falls in, and quiet rungs restate the quiet
 * vote's day peaks.
 */
export interface MagnitudeRung {
  member: string;
  referenceTime: string;
  /** See ExistenceRung.leadHours. */
  leadHours: number;
  vote: "window" | "quiet";
  /** Window: the day's windows' peak W*; quiet: the day's best W*. Null when unpublished or the run touches the day only via a spanner keyed elsewhere. */
  peakThermalVelocityMps: number | null;
  /** Launch-relative lift extent: a window rung's best in-day `peakLiftTopAboveLaunchM` (null without a launch); a quiet rung's `peakLiftDepthM`. The magnitude `settled` reads. */
  peakLiftAboveLaunchM: number | null;
  /** Covered duration summed over the run's windows keyed to this day; null for quiet rungs and via-only window rungs. */
  windowDurationHours: number | null;
  /** Ensemble runs only: the run's own per-day p10–p90 band widths at the day's peak-p50-W* hour — evidence with no narrowing verdict. */
  bandWidth?: { wstarBandWidthMps: number | null; liftTopBandWidthM: number | null };
}

/** Per target local day: run-by-run peak W*, launch-relative peak lift, and window duration, newest run first — the numbers whose run-to-run deltas state themselves. */
export interface MagnitudeTrajectoryFinding {
  kind: "magnitudeTrajectory";
  day: LocalDayKey;
  rungs: ReadonlyArray<MagnitudeRung>;
}

/** Non-meteorological facts that changed between runs, stated so a pipeline or model change is never read as weather. */
export interface IdentityDriftFinding {
  kind: "identityDrift";
  /** Republications the history loader's dedupe stated, passed through verbatim; empty when the caller supplied none. */
  revisions: ReadonlyArray<HistoryRevision>;
  /** Identity facts that differ between chronologically adjacent runs, newest pair first. */
  changes: ReadonlyArray<{
    fact: "modelElevationM" | "stepHours" | "hours";
    from: { referenceTime: string; value: number };
    to: { referenceTime: string; value: number };
  }>;
}

/**
 * Arithmetic stability, per target local day: whether the newest
 * `minRuns` runs' launch-relative lift magnitudes all sit within
 * `magnitudeBandM` of each other — a stability statement about runs,
 * not probability and not skill. False whenever the arithmetic cannot
 * run; the `sample` roster keeps "not stable" and "not statable"
 * readable apart.
 */
export interface SettledFinding {
  kind: "settled";
  day: LocalDayKey;
  settled: boolean;
  /** The newest `minRuns` runs' magnitudes (fewer when the comparison holds fewer runs), newest first — the sample the arithmetic reads. */
  sample: ReadonlyArray<{
    member: string;
    referenceTime: string;
    leadHours: number;
    /** See MagnitudeRung.peakLiftAboveLaunchM; null when the run stated no magnitude for the day. */
    peakLiftAboveLaunchM: number | null;
  }>;
  /** max − min over the sample's magnitudes; null when the sample is short of `minRuns` or any magnitude is null. */
  spreadM: number | null;
  thresholds: { minRuns: number; magnitudeBandM: number };
}

export type RunComparisonFinding =
  | ExistenceTrajectoryFinding
  | TimingTrajectoryFinding
  | MagnitudeTrajectoryFinding
  | IdentityDriftFinding
  | SettledFinding;
export type RunComparisonFindingKind = RunComparisonFinding["kind"];

/** The options both entry points share — the run axis's own knobs. */
export interface CompareRunsSharedOptions {
  /** `LoadedHistory.revisions` from the history loader, passed through so republications are stated on identityDrift instead of silenced. */
  revisions?: ReadonlyArray<HistoryRevision>;
  /** The lead anchor: hours after local midnight of the target day, in the comparison's timeZone (default 12); a wall time skipped by a DST transition resolves to the adjacent instant. */
  leadAnchorLocalHour?: number;
  /** `settled`'s constants, merged over `DEFAULT_SETTLED_THRESHOLDS`. */
  settled?: { minRuns?: number; magnitudeBandM?: number };
}

export interface CompareRunsOptions extends CompareRunsSharedOptions {
  /** One IANA timezone for the whole comparison — target days pair across runs only in one zone. */
  timeZone: string;
  /** One launch for every run's analysis; absent, window rungs state no launch-relative magnitude and `settled` reads false (not statable). */
  launch?: { elevationM: number } | null;
  /** Threshold overrides, applied identically to every run. */
  thresholds?: AnalyzeThresholdOverrides;
}

/** Options for `compareRunAnalyses`; timeZone, launch, and thresholds come from the envelopes and are validated, never supplied. */
export type CompareRunAnalysesOptions = CompareRunsSharedOptions;

export interface RunComparison {
  /** `RUN_COMPARISON_VOCABULARY_VERSION` — typed `number` under the tolerant-reader convention. */
  vocabularyVersion: number;
  /** The one model whose runs are compared. */
  model: string;
  site: { id: string; launchAltitudeM: number | null };
  timeZone: string;
  /** The one resolved threshold set every run was analyzed with. */
  thresholds: AnalyzeThresholds;
  newestReferenceTime: string;
  /** The lead anchor every `leadHours` in this envelope reads against — local hour of the target day. */
  leadAnchorLocalHour: number;
  /** Per-run ledger, newest first (the ladder order every rung array shares) — compare's member ledger reused verbatim. */
  runs: ReadonlyArray<ComparisonMemberLedger>;
  findings: RunComparisonFinding[];
  /** Each run's own analysis, keyed by member key — the rungs' provenance. */
  analyses: Readonly<Record<string, ForecastAnalysis>>;
}

/**
 * Compares one site's analyses across successive runs of one model — the
 * seam `compareRuns` wraps. Throws on mixed models or an empty list;
 * every other coherence check is delegated to `compareAnalyses` and
 * throws its named errors verbatim. Input order does not matter.
 */
export function compareRunAnalyses(
  analyses: ReadonlyArray<ForecastAnalysis>,
  options: CompareRunAnalysesOptions = {},
): RunComparison {
  if (analyses.length === 0) throw new Error("compareRuns: no runs");
  const model = analyses[0].model;
  for (const analysis of analyses) {
    if (analysis.model !== model) {
      throw new Error(
        `compareRuns: mixed models (${model} vs ${analysis.model}) — one comparison, one model's runs through time; models at one instant are compareForecasts' axis`,
      );
    }
  }

  const ascending = [...analyses].sort((a, b) =>
    a.run.referenceTime.localeCompare(b.run.referenceTime),
  );
  const comparison = compareAnalyses(ascending);

  const leadAnchorLocalHour = options.leadAnchorLocalHour ?? DEFAULT_LEAD_ANCHOR_LOCAL_HOUR;
  const settledThresholds = { ...DEFAULT_SETTLED_THRESHOLDS, ...options.settled };
  const timeZone = comparison.timeZone;
  const { wstarMinMps, depthMinM } = comparison.thresholds.thermalWindow;

  const runsNewestFirst = [...comparison.members].reverse();
  const referenceTimeOf = new Map(
    comparison.members.map((entry) => [entry.member, entry.referenceTime]),
  );

  const anchors = new Map<LocalDayKey, number>();
  const leadOf = (day: LocalDayKey, referenceTime: string): number => {
    let anchor = anchors.get(day);
    if (anchor === undefined) {
      anchor = localInstantMs(day, leadAnchorLocalHour, timeZone);
      anchors.set(day, anchor);
    }
    return round1((anchor - Date.parse(referenceTime)) / 3_600_000);
  };

  const dayBandsOf = new Map<string, EnsembleMembershipFinding["dayBands"]>();
  for (const entry of comparison.members) {
    const membership = comparison.analyses[entry.member].findings.find(
      (finding): finding is EnsembleMembershipFinding => finding.kind === "ensembleMembership",
    );
    if (membership) dayBandsOf.set(entry.member, membership.dayBands);
  }

  const findings: RunComparisonFinding[] = [];

  const revisions = [...(options.revisions ?? [])];
  const changes: IdentityDriftFinding["changes"][number][] = [];
  for (let i = comparison.members.length - 1; i >= 1; i -= 1) {
    const from = comparison.members[i - 1];
    const to = comparison.members[i];
    for (const fact of ["modelElevationM", "stepHours", "hours"] as const) {
      if (from[fact] !== to[fact]) {
        changes.push({
          fact,
          from: { referenceTime: from.referenceTime, value: from[fact] },
          to: { referenceTime: to.referenceTime, value: to[fact] },
        });
      }
    }
  }
  if (revisions.length > 0 || changes.length > 0) {
    findings.push({ kind: "identityDrift", revisions, changes });
  }

  const agreements = comparison.findings.filter(
    (finding): finding is WindowAgreementFinding => finding.kind === "windowAgreement",
  );
  for (const agreement of agreements) {
    const day = agreement.day;
    const windowsBy = new Map<string, WindowVote[]>();
    for (const vote of agreement.windows) {
      const bucket = windowsBy.get(vote.member);
      if (bucket) bucket.push(vote);
      else windowsBy.set(vote.member, [vote]);
    }
    const quietBy = new Map(agreement.quiet.map((vote) => [vote.member, vote]));
    const abstainedBy = new Map(agreement.abstained.map((entry) => [entry.member, entry]));

    const rungs: ExistenceRung[] = [];
    for (const run of runsNewestFirst) {
      const windows = windowsBy.get(run.member);
      const quiet = quietBy.get(run.member);
      const abstention = abstainedBy.get(run.member);
      const base = {
        member: run.member,
        referenceTime: run.referenceTime,
        leadHours: leadOf(day, run.referenceTime),
      };
      if (windows) {
        rungs.push({
          ...base,
          vote: "window",
          sensitivity: {
            wstarFlipAtMps: nearestTo(
              windows.map((vote) => vote.peakThermalVelocityMps),
              wstarMinMps,
            ),
            depthFlipAtM: nearestTo(
              windows
                .map((vote) => vote.peakLiftTopAboveLaunchM)
                .filter((value): value is number => value !== null),
              depthMinM,
            ),
          },
        });
      } else if (quiet) {
        rungs.push({
          ...base,
          vote: "quiet",
          failed: quiet.failed,
          sensitivity: {
            wstarFlipAtMps: quiet.peakThermalVelocityMps,
            depthFlipAtM: quiet.peakLiftDepthM,
          },
        });
      } else if (abstention) {
        rungs.push({
          ...base,
          vote: "abstained",
          abstained: abstention.reason,
          sensitivity: { wstarFlipAtMps: null, depthFlipAtM: null },
        });
      }
    }
    findings.push({
      kind: "existenceTrajectory",
      day,
      rungs,
      thresholds: { wstarMinMps, depthMinM },
    });

    const newestFirst = (a: { referenceTime: string }, b: { referenceTime: string }) =>
      b.referenceTime.localeCompare(a.referenceTime);
    const decorate = (vote: TimingVote): RunTimingVote => {
      const referenceTime = referenceTimeOf.get(vote.member)!;
      return { ...vote, referenceTime, leadHours: leadOf(day, referenceTime) };
    };
    const starts = agreement.timing.starts.map(decorate).sort(newestFirst);
    const ends = agreement.timing.ends.map(decorate).sort(newestFirst);
    if (starts.length + ends.length > 0) {
      findings.push({
        kind: "timingTrajectory",
        day,
        starts,
        ends,
        startSpreadHours: agreement.timing.startSpreadHours,
        startStepHoursMax: agreement.timing.startStepHoursMax,
        endSpreadHours: agreement.timing.endSpreadHours,
        endStepHoursMax: agreement.timing.endStepHoursMax,
      });
    }

    const magnitudeRungs: MagnitudeRung[] = [];
    for (const run of runsNewestFirst) {
      const windows = windowsBy.get(run.member);
      const quiet = quietBy.get(run.member);
      if (!windows && !quiet) continue;
      const dayBand = dayBandsOf
        .get(run.member)
        ?.find((entry) => entry.day === day && !entry.truncated);
      const base = {
        member: run.member,
        referenceTime: run.referenceTime,
        leadHours: leadOf(day, run.referenceTime),
        ...(dayBand
          ? {
              bandWidth: {
                wstarBandWidthMps: dayBand.wstarBandWidthMps,
                liftTopBandWidthM: dayBand.liftTopBandWidthM,
              },
            }
          : {}),
      };
      if (windows) {
        const own = windows.filter((vote) => vote.viaWindowFrom === undefined);
        const peaks = windows
          .map((vote) => vote.peakLiftTopAboveLaunchM)
          .filter(
            (value, index): value is number =>
              value !== null &&
              localDateKey(windows[index].peakLiftTopAt.validAt, timeZone) === day,
          );
        magnitudeRungs.push({
          ...base,
          vote: "window",
          peakThermalVelocityMps:
            own.length > 0 ? Math.max(...own.map((vote) => vote.peakThermalVelocityMps)) : null,
          peakLiftAboveLaunchM: peaks.length > 0 ? Math.max(...peaks) : null,
          windowDurationHours:
            own.length > 0 ? round1(own.reduce((sum, vote) => sum + vote.durationHours, 0)) : null,
        });
      } else if (quiet) {
        magnitudeRungs.push({
          ...base,
          vote: "quiet",
          peakThermalVelocityMps: quiet.peakThermalVelocityMps,
          peakLiftAboveLaunchM: quiet.peakLiftDepthM,
          windowDurationHours: null,
        });
      }
    }
    if (magnitudeRungs.length > 0) {
      findings.push({ kind: "magnitudeTrajectory", day, rungs: magnitudeRungs });
    }

    const magnitudeOf = new Map(magnitudeRungs.map((rung) => [rung.member, rung]));
    const sample = runsNewestFirst.slice(0, settledThresholds.minRuns).map((run) => ({
      member: run.member,
      referenceTime: run.referenceTime,
      leadHours: leadOf(day, run.referenceTime),
      peakLiftAboveLaunchM: magnitudeOf.get(run.member)?.peakLiftAboveLaunchM ?? null,
    }));
    const values = sample.map((entry) => entry.peakLiftAboveLaunchM);
    const statable =
      sample.length >= settledThresholds.minRuns &&
      values.every((value): value is number => value !== null);
    const spreadM = statable
      ? round1(Math.max(...(values as number[])) - Math.min(...(values as number[])))
      : null;
    findings.push({
      kind: "settled",
      day,
      settled: statable && spreadM! <= settledThresholds.magnitudeBandM,
      sample,
      spreadM,
      thresholds: { ...settledThresholds },
    });
  }

  return {
    vocabularyVersion: RUN_COMPARISON_VOCABULARY_VERSION,
    model,
    site: comparison.site,
    timeZone,
    thresholds: comparison.thresholds,
    newestReferenceTime: comparison.newestReferenceTime,
    leadAnchorLocalHour,
    runs: runsNewestFirst,
    findings,
    analyses: comparison.analyses,
  };
}

/**
 * Compares successive runs of one model at one site at the findings
 * level — the wrapper over `compareRunAnalyses` that analyzes each run
 * here with the comparison's single timeZone, launch, and threshold set.
 * The natural feed is `loadForecastHistory(...).runs`, with its
 * `revisions` passed through for identityDrift.
 */
export function compareRuns(
  runs: ReadonlyArray<SiteForecast>,
  options: CompareRunsOptions,
): RunComparison {
  const { timeZone, launch, thresholds, ...shared } = options;
  return compareRunAnalyses(
    runs.map((profile) => analyzeForecast(profile, { timeZone, launch, thresholds })),
    shared,
  );
}
