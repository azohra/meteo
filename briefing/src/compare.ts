import type { SiteForecast } from "./contract.js";
import { localDateKey } from "./derive/day-window.js";
import { componentsToWind, windToComponents } from "./derive/wind.js";
import {
  ANALYZE_VOCABULARY_VERSION,
  analyzeForecast,
  round1,
  round2,
  windowTouchedDays,
  type AnalyzeThresholdOverrides,
  type AnalyzeThresholds,
  type CitedInstant,
  type LocalDayKey,
  type PercentileToken,
  type QuietDayFinding,
  type ThermalWindowFinding,
  type WindDirectionFinding,
  type ForecastAnalysis,
  type WindSummaryFinding,
} from "./analyze/index.js";

/** The version of the comparison-kind set this module emits. */
export const COMPARE_VOCABULARY_VERSION = 3;

/** The member key: `"{model}@{referenceTime}"` — one member per (model, referenceTime) run; keys the envelope's `analyses` record and the ledger's `member` field. */
export function comparisonMemberKey(model: string, referenceTime: string): string {
  return `${model}@${referenceTime}`;
}

/** One member's comparability facts — stated, never scored. */
export interface ComparisonMemberLedger {
  /** The member key (`comparisonMemberKey(model, referenceTime)`). */
  member: string;
  model: string;
  kind: "deterministic" | "ensemble";
  referenceTime: string;
  /** Hours older than the newest member's run — a discount fact. */
  runAgeHours: number;
  /** The member's leading cadence (see ForecastAnalysis.stepHours); live documents can widen mid-horizon. */
  stepHours: number;
  hours: number;
  modelElevationM: number;
  /** The comparison's one launch; null when none was supplied. */
  launchAltitudeM: number | null;
  /** modelElevationM − launch; null when no launch was supplied. */
  elevationDeltaM: number | null;
  /** Non-null when the member cannot vote on window or height claims — its published lift top never reaches launch, so every launch-relative statement it makes is structurally biased; a benched member appears in no per-day roster. */
  benched: { reason: "terrainMismatch"; deltaM: number } | null;
}

/** A member's window vote for one local day (its findings restated). */
export interface WindowVote {
  member: string;
  model: string;
  start: CitedInstant;
  end: CitedInstant;
  clippedAtStart: boolean;
  clippedAtEnd: boolean;
  durationHours: number;
  /** The window finding's cadence echo: up to stepHours − 1 h of any timing difference against this vote is quantization, not disagreement. */
  stepHours: number;
  peakLiftTopAboveLaunchM: number | null;
  peakLiftTopAt: CitedInstant;
  peakThermalVelocityMps: number;
  /** The member's same-day percentileCrossing token; null means the member emitted no crossing for this day — an absence, not a confidence claim. */
  minimalPassingPercentile: PercentileToken | null;
  /** Present only when this vote is counted onto a day other than the window's own start day — names the window's own day, whose whole-window numbers the vote carries. */
  viaWindowFrom?: LocalDayKey;
}

/** A member's quiet vote for one local day (non-truncated by definition). */
export interface QuietVote {
  member: string;
  model: string;
  failed: QuietDayFinding["failed"];
  peakThermalVelocityMps: number | null;
  peakLiftDepthM: number | null;
}

/** Why a member is absent from a day's voters: `truncatedDay` = its document covers only a sliver of the day; `outOfHorizon` = it covers zero hours of the day. */
export interface Abstention {
  member: string;
  model: string;
  reason: "truncatedDay" | "outOfHorizon";
}

/** One member's unclipped window edge in a day's timing envelope. */
export interface TimingVote {
  member: string;
  model: string;
  at: CitedInstant;
  /** The contributing window's cadence echo (see WindowVote.stepHours). */
  stepHours: number;
}

/**
 * Per local day: who says the day has a thermal window, who says quiet,
 * who abstained and why — plus the timing envelope among unclipped edges.
 * `unanimous` is null below two voters; the finding is suppressed only
 * when a day has zero voters and zero abstentions.
 */
export interface WindowAgreementFinding {
  kind: "windowAgreement";
  day: LocalDayKey;
  windows: ReadonlyArray<WindowVote>;
  quiet: ReadonlyArray<QuietVote>;
  abstained: ReadonlyArray<Abstention>;
  voters: number;
  unanimous: boolean | null;
  /** The smallest threshold move that would flip a voter, stated as the flip value (the voter's own peak nearest each floor); null when no voter offers the quantity. Exact for window votes; necessary but not sufficient for quiet votes. */
  sensitivity: {
    wstarFlipAtMps: number | null;
    depthFlipAtM: number | null;
  };
  /** Start/end spreads among unclipped edges only, each edge joining the day whose local date contains its instant; `startStepHoursMax`/`endStepHoursMax` state the widest contributing cadence, within which a spread is quantization rather than disagreement. */
  timing: {
    startSpreadHours: number | null;
    /** Widest stepHours among `starts`; null when `starts` is empty. */
    startStepHoursMax: number | null;
    endSpreadHours: number | null;
    /** Widest stepHours among `ends`; null when `ends` is empty. */
    endStepHoursMax: number | null;
    starts: ReadonlyArray<TimingVote>;
    ends: ReadonlyArray<TimingVote>;
  };
}

/** Launch-relative peak lift per voting member with the spread — deliberately no mean or consensus height; emitted for days where at least two unbenched members report a launch-relative peak in the day. */
export interface HeightSpreadFinding {
  kind: "heightSpread";
  day: LocalDayKey;
  peaks: ReadonlyArray<{
    member: string;
    model: string;
    peakLiftTopAboveLaunchM: number;
    at: CitedInstant;
    /** The ensemble member's own p10–p90 lift-top band at its peak hour, launch-relative; null for deterministic members and where the evidence carries no band. Verdict-free context — never an outlier detector. */
    bandP10P90AboveLaunchM: [number, number] | null;
  }>;
  spreadM: number;
}

/** One voting member's in-window climb-band wind maximum. */
export interface BandWindEntry {
  member: string;
  model: string;
  windMps: number;
  heightM: number;
  at: CitedInstant;
  /** Mandatory regime echo — models grounding the site hundreds of metres apart forecast different flow regimes, and the roster is only readable with each member's ground beside its number. */
  modelElevationM: number;
  /** "duringWindow" when the member's same-day windSummary carries the window-scoped block; "wholeDay" only on via-window days where the whole-day maximum is the honest fallback. */
  scope: "duringWindow" | "wholeDay";
}

/** One voting member's gust maximum, rostered within its semantics class. */
export interface GustEntry {
  member: string;
  model: string;
  gustMps: number;
  at: CitedInstant;
  /** Same mandatory regime echo as BandWindEntry.modelElevationM. */
  modelElevationM: number;
  scope: "duringWindow" | "wholeDay";
}

/**
 * Wind divergence among a day's window voters: each member's in-window
 * climb-band wind maximum with the spread. Gust rosters group strictly
 * within one declared semantics class (undeclared gusts roster with no
 * spread); shear rates and directions never appear here.
 */
export interface WindDivergenceFinding {
  kind: "windDivergence";
  day: LocalDayKey;
  bandWind: {
    entries: ReadonlyArray<BandWindEntry>;
    /** max − min of the rostered windMps; null below two entries. */
    spreadMps: number | null;
  };
  gust: {
    hourMax: { entries: ReadonlyArray<GustEntry>; spreadMps: number | null };
    instant: { entries: ReadonlyArray<GustEntry>; spreadMps: number | null };
    /** Rostered, never spread — an undeclared gust cannot be compared with anything. */
    undeclared: { entries: ReadonlyArray<GustEntry> };
  };
}

/**
 * Surface-flow direction split among a day's deterministic window voters:
 * window vector-mean directions (raw degrees are never averaged, and
 * ensembles never roster), the maximum pairwise angular separation, and
 * the max-separation pair with both members' model elevations — the
 * regime caveat rides the statement. Emitted when at least two members
 * roster a direction.
 */
export interface WindDirectionSpreadFinding {
  kind: "windDirectionSpread";
  day: LocalDayKey;
  entries: ReadonlyArray<{
    member: string;
    model: string;
    directionDeg: number;
    speedMps: number;
    /** Same mandatory regime echo as windDivergence's rosters. */
    modelElevationM: number;
  }>;
  /** Max pairwise circular separation among the entries, 0–180°. */
  maxAngularSeparationDeg: number;
  /** The pair realizing the maximum, with the regime facts beside it. */
  maxSeparation: {
    members: [string, string];
    models: [string, string];
    modelElevationM: [number, number];
    elevationDeltaM: number;
  };
  thresholds: { directionFloorMps: number };
}

export type ComparisonFinding =
  | WindowAgreementFinding
  | HeightSpreadFinding
  | WindDivergenceFinding
  | WindDirectionSpreadFinding;
export type ComparisonFindingKind = ComparisonFinding["kind"];

export interface CompareOptions {
  /** One IANA timezone for the whole comparison — day keys pair across members only in one zone. */
  timeZone: string;
  /** Threshold overrides, applied identically to every member. */
  thresholds?: AnalyzeThresholdOverrides;
  /** One launch for the whole comparison, passed to every member's analysis; absent, members analyze launch-free (no benching, no launch-relative peaks, no heightSpread). */
  launch?: { elevationM: number } | null;
  /** Models whose documents never arrived (the transport's DocumentMiss), passed through so the roster names the whole field. */
  unavailable?: ReadonlyArray<{ model: string; miss: "absent" | "invalid" }>;
}

export interface ForecastComparison {
  /** The comparison-vocabulary version that produced this envelope — typed `number` under the tolerant-reader convention. */
  vocabularyVersion: number;
  /** The compared site plus the comparison's launch; launchAltitudeM is null when no launch was supplied. */
  site: { id: string; launchAltitudeM: number | null };
  timeZone: string;
  /** The one threshold set every member was analyzed with. */
  thresholds: AnalyzeThresholds;
  newestReferenceTime: string;
  members: ReadonlyArray<ComparisonMemberLedger>;
  unavailable: ReadonlyArray<{ model: string; miss: "absent" | "invalid" }>;
  findings: ComparisonFinding[];
  /** Each member's own analysis — the votes' provenance, keyed by the member key (`comparisonMemberKey(model, referenceTime)`). */
  analyses: Readonly<Record<string, ForecastAnalysis>>;
}

/** Options for `compareAnalyses`; timeZone, launch, and thresholds come from the members themselves and are validated, never supplied. */
export interface CompareAnalysesOptions {
  /** See `CompareOptions.unavailable`. */
  unavailable?: ReadonlyArray<{ model: string; miss: "absent" | "invalid" }>;
}

/**
 * Compares one site's analyses across members at the findings level,
 * validating the envelopes' self-described coherence (site, vocabulary
 * version, timeZone, launch, thresholds) and throwing a distinct, named
 * error on each failure.
 */
export function compareAnalyses(
  analyses: ReadonlyArray<ForecastAnalysis>,
  options: CompareAnalysesOptions = {},
): ForecastComparison {
  if (analyses.length === 0) throw new Error("compareAnalyses: no members");
  const reference = analyses[0];
  const siteId = reference.site.id;
  const seen = new Set<string>();
  for (const analysis of analyses) {
    const member = comparisonMemberKey(analysis.model, analysis.run.referenceTime);
    if (analysis.site.id !== siteId) {
      throw new Error(
        `compareAnalyses: mixed sites (${siteId} vs ${analysis.site.id}) — one comparison, one site`,
      );
    }
    if (seen.has(member)) {
      throw new Error(
        `compareAnalyses: duplicate member (${member}) — a member is one (model, referenceTime) run; two runs of one model are two members, the same run twice is an error`,
      );
    }
    seen.add(member);
    if (analysis.vocabularyVersion !== ANALYZE_VOCABULARY_VERSION) {
      throw new Error(
        `compareAnalyses: vocabulary version skew — member ${member} carries vocabularyVersion ${analysis.vocabularyVersion}, this package compares vocabulary ${ANALYZE_VOCABULARY_VERSION}; re-analyze the forecast with this package, or compare with the package that produced it`,
      );
    }
    for (const field of ["thresholds", "deterministic", "coveredDays"] as const) {
      if (analysis[field] === undefined) {
        throw new Error(
          `compareAnalyses: member ${member} lacks ${field} — an envelope from windgram (npm) versions before 0.22 does not self-describe; re-analyze the forecast with this package, or compare with the package that produced it`,
        );
      }
    }
    if (analysis.timeZone !== reference.timeZone) {
      throw new Error(
        `compareAnalyses: mixed timezones (${reference.timeZone} vs ${analysis.timeZone}) — day keys pair only in one zone`,
      );
    }
    if (analysis.site.launchAltitudeM !== reference.site.launchAltitudeM) {
      throw new Error(
        `compareAnalyses: mixed launches (${reference.site.launchAltitudeM} vs ${analysis.site.launchAltitudeM}) — launch-relative votes compare only against one launch`,
      );
    }
    const differs = firstThresholdDifference(reference.thresholds, analysis.thresholds, "");
    if (differs) {
      throw new Error(
        `compareAnalyses: threshold mismatch (${differs}) — one comparison, one threshold set`,
      );
    }
  }

  const timeZone = reference.timeZone;
  const thresholds = reference.thresholds;
  const launch = reference.site.launchAltitudeM;
  const analysesByMember: Record<string, ForecastAnalysis> = {};
  for (const analysis of analyses) {
    analysesByMember[comparisonMemberKey(analysis.model, analysis.run.referenceTime)] = analysis;
  }

  const newestReferenceTime = analyses
    .map((analysis) => analysis.run.referenceTime)
    .sort()
    .at(-1)!;
  const members: ComparisonMemberLedger[] = analyses.map((analysis) => {
    const member = comparisonMemberKey(analysis.model, analysis.run.referenceTime);
    const terrain = analysis.findings.find((finding) => finding.kind === "terrainMismatch");
    return {
      member,
      model: analysis.model,
      kind: analysis.deterministic ? "deterministic" : "ensemble",
      referenceTime: analysis.run.referenceTime,
      runAgeHours:
        (Date.parse(newestReferenceTime) - Date.parse(analysis.run.referenceTime)) / 3_600_000,
      stepHours: analysis.stepHours,
      hours: analysis.hours,
      modelElevationM: analysis.site.modelElevationM,
      launchAltitudeM: launch,
      elevationDeltaM: launch === null ? null : round1(analysis.site.modelElevationM - launch),
      benched:
        terrain && !terrain.liftTopEverReachesLaunch
          ? { reason: "terrainMismatch", deltaM: terrain.deltaM }
          : null,
    };
  });
  const ledgerByMember = new Map(members.map((entry) => [entry.member, entry]));
  const benched = new Set(
    members.filter((entry) => entry.benched !== null).map((entry) => entry.member),
  );

  const coveredDays = new Map<string, Set<LocalDayKey>>();
  const allDays = new Set<LocalDayKey>();
  for (const entry of members) {
    const days = new Set(analysesByMember[entry.member].coveredDays);
    coveredDays.set(entry.member, days);
    for (const day of days) allDays.add(day);
  }

  const at = (member: string, day: LocalDayKey) => `${member}|${day}`;
  const crossingTokens = new Map<string, PercentileToken | null>();
  const windowFindings = new Map<string, ThermalWindowFinding[]>();
  const summaries = new Map<string, WindSummaryFinding>();
  const directionFindings = new Map<string, WindDirectionFinding[]>();
  for (const entry of members) {
    if (benched.has(entry.member)) continue;
    for (const finding of analysesByMember[entry.member].findings) {
      if (finding.kind === "percentileCrossing") {
        crossingTokens.set(at(entry.member, finding.day), finding.minimalPassingPercentile);
      } else if (finding.kind === "windSummary") {
        summaries.set(at(entry.member, finding.day), finding);
      } else if (finding.kind === "windDirection") {
        const bucket = directionFindings.get(at(entry.member, finding.day)) ?? [];
        bucket.push(finding);
        directionFindings.set(at(entry.member, finding.day), bucket);
      } else if (finding.kind === "thermalWindow") {
        const bucket = windowFindings.get(entry.member) ?? [];
        bucket.push(finding);
        windowFindings.set(entry.member, bucket);
      }
    }
  }

  const byDay = new Map<
    LocalDayKey,
    { windows: WindowVote[]; quiet: QuietVote[]; abstained: Abstention[] }
  >();
  const dayOf = (day: LocalDayKey) => {
    let entry = byDay.get(day);
    if (!entry) byDay.set(day, (entry = { windows: [], quiet: [], abstained: [] }));
    return entry;
  };
  for (const entry of members) {
    if (benched.has(entry.member)) continue;
    for (const finding of analysesByMember[entry.member].findings) {
      if (finding.kind === "thermalWindow") {
        for (const day of windowTouchedDays(finding, timeZone)) {
          dayOf(day).windows.push({
            member: entry.member,
            model: entry.model,
            start: finding.start,
            end: finding.end,
            clippedAtStart: finding.clippedAtStart,
            clippedAtEnd: finding.clippedAtEnd,
            durationHours: finding.durationHours,
            stepHours: finding.stepHours,
            peakLiftTopAboveLaunchM: finding.peakLiftTopAboveLaunchM,
            peakLiftTopAt: finding.peakLiftTopAt,
            peakThermalVelocityMps: finding.peakThermalVelocityMps,
            minimalPassingPercentile: crossingTokens.get(at(entry.member, day)) ?? null,
            ...(day === finding.day ? {} : { viaWindowFrom: finding.day }),
          });
        }
      } else if (finding.kind === "quietDay") {
        if (finding.coverage.truncated) {
          dayOf(finding.day).abstained.push({
            member: entry.member,
            model: entry.model,
            reason: "truncatedDay",
          });
        } else {
          dayOf(finding.day).quiet.push({
            member: entry.member,
            model: entry.model,
            failed: finding.failed,
            peakThermalVelocityMps: finding.peakThermalVelocityMps,
            peakLiftDepthM: finding.peakLiftDepthM,
          });
        }
      }
    }
  }

  for (const day of allDays) {
    const votes = dayOf(day);
    for (const entry of members) {
      if (benched.has(entry.member)) continue;
      if (!coveredDays.get(entry.member)!.has(day)) {
        votes.abstained.push({ member: entry.member, model: entry.model, reason: "outOfHorizon" });
      }
    }
  }

  const findings: ComparisonFinding[] = [];
  for (const [day, votes] of [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const windowMembers = new Set(votes.windows.map((vote) => vote.member));
    const voters = windowMembers.size + votes.quiet.length;
    if (voters === 0 && votes.abstained.length === 0) continue;

    const firstWindows = new Map<string, WindowVote>();
    const lastWindows = new Map<string, WindowVote>();
    for (const vote of votes.windows) {
      const first = firstWindows.get(vote.member);
      if (!first || vote.start.validAt < first.start.validAt) firstWindows.set(vote.member, vote);
      const last = lastWindows.get(vote.member);
      if (!last || vote.end.validAt > last.end.validAt) lastWindows.set(vote.member, vote);
    }
    const starts: TimingVote[] = [...firstWindows.values()]
      .filter((vote) => !vote.clippedAtStart && localDateKey(vote.start.validAt, timeZone) === day)
      .map((vote) => ({
        member: vote.member,
        model: vote.model,
        at: vote.start,
        stepHours: vote.stepHours,
      }));
    const ends: TimingVote[] = [...lastWindows.values()]
      .filter((vote) => !vote.clippedAtEnd && localDateKey(vote.end.validAt, timeZone) === day)
      .map((vote) => ({
        member: vote.member,
        model: vote.model,
        at: vote.end,
        stepHours: vote.stepHours,
      }));

    const wstarCandidates = [
      ...votes.windows.map((vote) => vote.peakThermalVelocityMps),
      ...votes.quiet
        .map((vote) => vote.peakThermalVelocityMps)
        .filter((value): value is number => value !== null),
    ];
    const depthCandidates = [
      ...votes.windows
        .map((vote) => vote.peakLiftTopAboveLaunchM)
        .filter((value): value is number => value !== null),
      ...votes.quiet
        .map((vote) => vote.peakLiftDepthM)
        .filter((value): value is number => value !== null),
    ];

    findings.push({
      kind: "windowAgreement",
      day,
      windows: votes.windows,
      quiet: votes.quiet,
      abstained: votes.abstained,
      voters,
      unanimous: voters < 2 ? null : windowMembers.size === 0 || votes.quiet.length === 0,
      sensitivity: {
        wstarFlipAtMps: nearestTo(wstarCandidates, thresholds.thermalWindow.wstarMinMps),
        depthFlipAtM: nearestTo(depthCandidates, thresholds.thermalWindow.depthMinM),
      },
      timing: {
        startSpreadHours: spreadHours(starts.map((entry) => entry.at)),
        startStepHoursMax:
          starts.length === 0 ? null : Math.max(...starts.map((entry) => entry.stepHours)),
        endSpreadHours: spreadHours(ends.map((entry) => entry.at)),
        endStepHoursMax:
          ends.length === 0 ? null : Math.max(...ends.map((entry) => entry.stepHours)),
        starts,
        ends,
      },
    });

    const peaks: Array<HeightSpreadFinding["peaks"][number]> = [];
    for (const member of windowMembers) {
      const best = votes.windows
        .filter(
          (vote) =>
            vote.member === member &&
            vote.peakLiftTopAboveLaunchM !== null &&
            localDateKey(vote.peakLiftTopAt.validAt, timeZone) === day,
        )
        .sort((a, b) => b.peakLiftTopAboveLaunchM! - a.peakLiftTopAboveLaunchM!)[0];
      if (best) {
        peaks.push({
          member,
          model: best.model,
          peakLiftTopAboveLaunchM: best.peakLiftTopAboveLaunchM!,
          at: best.peakLiftTopAt,
          bandP10P90AboveLaunchM: bandAtPeak(windowFindings.get(member) ?? [], best, launch),
        });
      }
    }
    if (peaks.length >= 2) {
      const values = peaks.map((peak) => peak.peakLiftTopAboveLaunchM);
      findings.push({
        kind: "heightSpread",
        day,
        peaks,
        spreadM: round1(Math.max(...values) - Math.min(...values)),
      });
    }

    const bandEntries: BandWindEntry[] = [];
    const gustRosters: Record<"hourMax" | "instant" | "undeclared", GustEntry[]> = {
      hourMax: [],
      instant: [],
      undeclared: [],
    };
    for (const member of windowMembers) {
      const summary = summaries.get(at(member, day));
      if (!summary) continue;
      const ledger = ledgerByMember.get(member)!;
      const scoped = summary.duringWindow;
      const band = scoped ? scoped.maxWindInBand : summary.maxWindInBand;
      const gust = scoped ? scoped.maxGust : summary.maxGust;
      const scope: BandWindEntry["scope"] = scoped ? "duringWindow" : "wholeDay";
      if (band) {
        bandEntries.push({
          member,
          model: ledger.model,
          windMps: band.windMps,
          heightM: band.heightM,
          at: band.at,
          modelElevationM: ledger.modelElevationM,
          scope,
        });
      }
      if (gust) {
        gustRosters[gust.semantics ?? "undeclared"].push({
          member,
          model: ledger.model,
          gustMps: gust.gustMps,
          at: gust.at,
          modelElevationM: ledger.modelElevationM,
          scope,
        });
      }
    }
    if (
      bandEntries.length >= 2 ||
      gustRosters.hourMax.length >= 2 ||
      gustRosters.instant.length >= 2
    ) {
      findings.push({
        kind: "windDivergence",
        day,
        bandWind: {
          entries: bandEntries,
          spreadMps: spreadOf(bandEntries.map((entry) => entry.windMps)),
        },
        gust: {
          hourMax: {
            entries: gustRosters.hourMax,
            spreadMps: spreadOf(gustRosters.hourMax.map((entry) => entry.gustMps)),
          },
          instant: {
            entries: gustRosters.instant,
            spreadMps: spreadOf(gustRosters.instant.map((entry) => entry.gustMps)),
          },
          undeclared: { entries: gustRosters.undeclared },
        },
      });
    }

    const directionEntries: WindDirectionSpreadFinding["entries"][number][] = [];
    const floor = thresholds.windDirection.directionFloorMps;
    for (const member of windowMembers) {
      const dayFindings = directionFindings.get(at(member, day)) ?? [];
      let uSum = 0;
      let vSum = 0;
      let weight = 0;
      for (const finding of dayFindings) {
        const mean = finding.surfaceVectorMean;
        if (mean.directionDeg === null) continue;
        const samples = finding.evidence.hours.length;
        const { uMps, vMps } = windToComponents(mean.speedMps, mean.directionDeg);
        uSum += uMps * samples;
        vSum += vMps * samples;
        weight += samples;
      }
      if (weight === 0) continue;
      const combined = componentsToWind(uSum / weight, vSum / weight);
      if (combined.speedMps < floor) continue;
      const ledger = ledgerByMember.get(member)!;
      directionEntries.push({
        member,
        model: ledger.model,
        directionDeg: Math.round(combined.directionDeg),
        speedMps: round2(combined.speedMps),
        modelElevationM: ledger.modelElevationM,
      });
    }
    if (directionEntries.length >= 2) {
      let bestA = directionEntries[0];
      let bestB = directionEntries[1];
      let maxSeparation = angularSeparationDeg(bestA.directionDeg, bestB.directionDeg);
      for (let i = 0; i < directionEntries.length; i += 1) {
        for (let j = i + 1; j < directionEntries.length; j += 1) {
          const separation = angularSeparationDeg(
            directionEntries[i].directionDeg,
            directionEntries[j].directionDeg,
          );
          if (separation > maxSeparation) {
            maxSeparation = separation;
            bestA = directionEntries[i];
            bestB = directionEntries[j];
          }
        }
      }
      findings.push({
        kind: "windDirectionSpread",
        day,
        entries: directionEntries,
        maxAngularSeparationDeg: maxSeparation,
        maxSeparation: {
          members: [bestA.member, bestB.member],
          models: [bestA.model, bestB.model],
          modelElevationM: [bestA.modelElevationM, bestB.modelElevationM],
          elevationDeltaM: round1(Math.abs(bestA.modelElevationM - bestB.modelElevationM)),
        },
        thresholds: { directionFloorMps: floor },
      });
    }
  }

  return {
    vocabularyVersion: COMPARE_VOCABULARY_VERSION,
    site: { id: siteId, launchAltitudeM: launch },
    timeZone,
    thresholds,
    newestReferenceTime,
    members,
    unavailable: options.unavailable ?? [],
    findings,
    analyses: analysesByMember,
  };
}

/**
 * Compares one site's documents across models at the findings level — the
 * wrapper over `compareAnalyses` that analyzes every profile here with the
 * comparison's single timeZone, launch, and threshold set, so the members'
 * envelopes validate coherent by construction.
 */
export function compareForecasts(
  profiles: ReadonlyArray<SiteForecast>,
  options: CompareOptions,
): ForecastComparison {
  return compareAnalyses(
    profiles.map((profile) =>
      analyzeForecast(profile, {
        timeZone: options.timeZone,
        launch: options.launch,
        thresholds: options.thresholds,
      }),
    ),
    { unavailable: options.unavailable },
  );
}

function firstThresholdDifference(a: unknown, b: unknown, path: string): string | null {
  if (a === b) return null;
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const difference = firstThresholdDifference(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      );
      if (difference !== null) return difference;
    }
    return null;
  }
  return `${path}: ${String(a)} vs ${String(b)}`;
}

function spreadHours(instants: ReadonlyArray<CitedInstant>): number | null {
  if (instants.length < 2) return null;
  const times = instants.map((instant) => Date.parse(instant.validAt));
  return round1((Math.max(...times) - Math.min(...times)) / 3_600_000);
}

function spreadOf(values: ReadonlyArray<number>): number | null {
  if (values.length < 2) return null;
  return round2(Math.max(...values) - Math.min(...values));
}

/** The candidate nearest a floor — a run's sensitivity "flip value"; ties keep the smaller candidate, and no candidates is null. */
export function nearestTo(candidates: ReadonlyArray<number>, floor: number): number | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, value) => {
    const distance = Math.abs(value - floor);
    const bestDistance = Math.abs(best - floor);
    if (distance < bestDistance) return value;
    if (distance === bestDistance && value < best) return value;
    return best;
  });
}

function angularSeparationDeg(aDeg: number, bDeg: number): number {
  const delta = Math.abs(aDeg - bDeg) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function bandAtPeak(
  windows: ReadonlyArray<ThermalWindowFinding>,
  vote: WindowVote,
  launch: number | null,
): [number, number] | null {
  if (launch === null) return null;
  const finding = windows.find(
    (candidate) =>
      candidate.start.validAt === vote.start.validAt && candidate.end.validAt === vote.end.validAt,
  );
  if (!finding || !finding.evidence.liftTopBandP10P90) return null;
  const index = finding.evidence.hours.indexOf(vote.peakLiftTopAt.validAt);
  if (index < 0) return null;
  const band = finding.evidence.liftTopBandP10P90[index];
  if (band === null) return null;
  return [round1(band[0] - launch), round1(band[1] - launch)];
}
