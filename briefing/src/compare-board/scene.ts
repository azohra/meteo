import {
  ANALYZE_VOCABULARY_VERSION,
  windowTouchedDays,
  type CapTimingFinding,
  type CitedInstant,
  type ConvectiveDayFinding,
  type ForecastAnalysis,
  type LiftCeilingFinding,
  type PercentileCrossingFinding,
  type QuietDayFinding,
  type ThermalWindowFinding,
  type WindDirectionFinding,
  type WindExceedanceFinding,
  type WindSummaryFinding,
} from "../analyze/index.js";
import { comparisonMemberKey, type ForecastComparison } from "../compare.js";

import { compareBoardDayAxis, xForBoardTime } from "./axis.js";
import type {
  BoardInstant,
  BoardSpan,
  CompareBoardAloft,
  CompareBoardAxis,
  CompareBoardExceedance,
  CompareBoardGust,
  CompareBoardLaunch,
  CompareBoardOptions,
  CompareBoardRow,
  CompareBoardScene,
  CompareBoardStorms,
  CompareBoardTop,
  CompareBoardVote,
  CompareBoardWindow,
} from "./types.js";

/**
 * One local day across a comparison's members, as marks on one shared
 * clock — the scene is the product; renderers (this package's minimal
 * SVG included) draw it without re-deriving anything. Consumes only what
 * the analyses already state: every threshold on the board (wind
 * ceilings, floors) arrived inside the analyses the caller built, and
 * the board adds no judgment of its own.
 *
 * `comparison` orders the rows and names the non-votes (benched members);
 * pass null to board bare analyses in input order. Coherence is
 * validated, not reconstructed: one site, one timezone (the options'
 * own, since day keys pair only in one zone), one analysis vocabulary,
 * distinct members.
 */
export function buildCompareBoardScene(
  analyses: ReadonlyArray<ForecastAnalysis>,
  comparison: ForecastComparison | null,
  options: CompareBoardOptions,
): CompareBoardScene {
  if (analyses.length === 0) throw new Error("buildCompareBoardScene: no members");
  const axis = compareBoardDayAxis(options);
  const dateKey = options.dateKey;
  const timeZone = options.timeZone;

  const siteId = analyses[0].site.id;
  const byMember = new Map<string, ForecastAnalysis>();
  for (const analysis of analyses) {
    const member = comparisonMemberKey(analysis.model, analysis.run.referenceTime);
    if (analysis.vocabularyVersion !== ANALYZE_VOCABULARY_VERSION) {
      throw new Error(
        `buildCompareBoardScene: vocabulary version skew — member ${member} carries vocabularyVersion ${analysis.vocabularyVersion}, this package reads vocabulary ${ANALYZE_VOCABULARY_VERSION}; re-analyze the forecast with this package`,
      );
    }
    if (analysis.site.id !== siteId) {
      throw new Error(
        `buildCompareBoardScene: mixed sites (${siteId} vs ${analysis.site.id}) — one board, one site`,
      );
    }
    if (analysis.timeZone !== timeZone) {
      throw new Error(
        `buildCompareBoardScene: member ${member} was analyzed in ${analysis.timeZone}, the board reads ${timeZone} — day keys pair only in one zone`,
      );
    }
    if (byMember.has(member)) {
      throw new Error(
        `buildCompareBoardScene: duplicate member (${member}) — the same run twice is an error`,
      );
    }
    byMember.set(member, analysis);
  }
  if (comparison && comparison.timeZone !== timeZone) {
    throw new Error(
      `buildCompareBoardScene: the comparison reads ${comparison.timeZone}, the board ${timeZone} — one zone for both`,
    );
  }

  /* Rows in comparison order; bare analyses keep input order. */
  let ordered: string[];
  if (comparison) {
    const ledgerMembers = new Set(comparison.members.map((entry) => entry.member));
    for (const member of byMember.keys()) {
      if (!ledgerMembers.has(member)) {
        throw new Error(
          `buildCompareBoardScene: member ${member} is not in the comparison's ledger — board the comparison's own analyses, or pass comparison null`,
        );
      }
    }
    ordered = comparison.members
      .map((entry) => entry.member)
      .filter((member) => byMember.has(member));
  } else {
    ordered = [...byMember.keys()];
  }

  const benchedByMember = new Map(
    (comparison?.members ?? [])
      .filter((entry) => entry.benched !== null)
      .map((entry) => [entry.member, entry.benched!]),
  );

  const rows = ordered.map((member) =>
    buildRow(member, byMember.get(member)!, benchedByMember.get(member) ?? null, axis, {
      dateKey,
      timeZone,
    }),
  );

  return { dateKey, timeZone, axis, rows };
}

interface DayContext {
  dateKey: string;
  timeZone: string;
}

const HOUR_MS = 3_600_000;

function stepMs(stepHours: number): number {
  return Math.max(1, stepHours) * HOUR_MS;
}

function buildRow(
  member: string,
  analysis: ForecastAnalysis,
  benched: { reason: "terrainMismatch"; deltaM: number } | null,
  axis: CompareBoardAxis,
  day: DayContext,
): CompareBoardRow {
  const instant = (at: CitedInstant): BoardInstant => {
    const atMs = Date.parse(at.validAt);
    return { x: xForBoardTime(axis, atMs), atMs, at };
  };
  const span = (start: CitedInstant, end: CitedInstant, stepHours: number): BoardSpan => {
    const startMs = Date.parse(start.validAt);
    const endCitedMs = Date.parse(end.validAt);
    const endMs = endCitedMs + stepMs(stepHours);
    return {
      x0: xForBoardTime(axis, startMs),
      x1: xForBoardTime(axis, endMs),
      x1Cited: xForBoardTime(axis, endCitedMs),
      startMs,
      endMs,
      endCitedMs,
      start,
      end,
      stepHours,
    };
  };

  /* Windows touching the day — a midnight-spanning window draws its
     in-day part and confesses its home day via viaWindowFrom; structurally
     the same electorate windowAgreement counts. */
  const windows: CompareBoardWindow[] = [];
  let touchesDay = false;
  for (const finding of analysis.findings) {
    if (finding.kind !== "thermalWindow") continue;
    const window = finding as ThermalWindowFinding;
    if (!windowTouchedDays(window, day.timeZone).includes(day.dateKey)) continue;
    touchesDay = true;
    windows.push({
      ...span(window.start, window.end, window.stepHours),
      clippedAtStart: window.clippedAtStart,
      clippedAtEnd: window.clippedAtEnd,
      peakLiftTopM: window.peakLiftTopM,
      peakLiftTopAboveLaunchM: window.peakLiftTopAboveLaunchM,
      peakThermalVelocityMps: window.peakThermalVelocityMps,
      ...(window.day === day.dateKey ? {} : { viaWindowFrom: window.day }),
    });
  }
  windows.sort((a, b) => a.startMs - b.startMs);

  const exceedances: CompareBoardExceedance[] = [];
  const overCeiling = { surfaceWind: false, gust: false, bandWind: false };
  for (const finding of analysis.findings) {
    if (finding.kind !== "windExceedance" || finding.day !== day.dateKey) continue;
    const exceedance = finding as WindExceedanceFinding;
    if (exceedance.runs.length === 0) continue;
    overCeiling[exceedance.quantity] = true;
    exceedances.push({
      quantity: exceedance.quantity,
      thresholdMps: exceedance.thresholdMps,
      ...(exceedance.gustSemantics ? { gustSemantics: exceedance.gustSemantics } : {}),
      stepHours: exceedance.stepHours,
      runs: exceedance.runs.map((run) => ({
        ...span(run.start, run.end, exceedance.stepHours),
        peakMps: run.peakMps,
        peakAt: instant(run.peakAt),
      })),
    });
  }

  const capTiming = analysis.findings.find(
    (finding): finding is CapTimingFinding =>
      finding.kind === "capTiming" && finding.day === day.dateKey,
  );
  const convective = analysis.findings.find(
    (finding): finding is ConvectiveDayFinding =>
      finding.kind === "convectiveDay" && finding.day === day.dateKey,
  );
  const quiet = analysis.findings.find(
    (finding): finding is QuietDayFinding =>
      finding.kind === "quietDay" && finding.day === day.dateKey,
  );

  const storms = buildStorms(capTiming, convective, analysis, instant, axis);

  let rainStart: CompareBoardRow["rainStart"] = null;
  if (capTiming?.precipStartsAt) {
    rainStart = { ...instant(capTiming.precipStartsAt), source: "capTiming" };
  } else if (convective?.precipStartsAt) {
    rainStart = { ...instant(convective.precipStartsAt), source: "convectiveDay" };
  } else if (quiet?.context.precipitation) {
    rainStart = { ...instant(quiet.context.precipitation.firstWetAt), source: "quietDay" };
  }

  const direction = analysis.findings.find(
    (finding): finding is WindDirectionFinding =>
      finding.kind === "windDirection" && finding.day === day.dateKey,
  );
  const launch: CompareBoardLaunch | null = direction
    ? {
        window: direction.window,
        start: direction.surface.start,
        peakLift: {
          directionDeg: direction.surface.peakLift.directionDeg,
          speedMps: direction.surface.peakLift.speedMps,
          at: instant(direction.surface.peakLift.at),
        },
        end: direction.surface.end,
        netVeerDeg: direction.netVeerDeg,
        directionFloorMps: direction.thresholds.directionFloorMps,
      }
    : null;

  const summary = analysis.findings.find(
    (finding): finding is WindSummaryFinding =>
      finding.kind === "windSummary" && finding.day === day.dateKey,
  );
  const gustFact = summary?.duringWindow?.maxGust ?? summary?.maxGust;
  const gustScope: "duringWindow" | "wholeDay" = summary?.duringWindow?.maxGust
    ? "duringWindow"
    : "wholeDay";
  const gust: CompareBoardGust | null = gustFact
    ? {
        gustMps: gustFact.gustMps,
        meanWindMps: gustFact.meanWindMps,
        semantics: gustFact.semantics ?? null,
        at: instant(gustFact.at),
        scope: gustScope,
      }
    : null;

  const scopedBand = summary?.duringWindow?.maxWindInBand;
  const wholeDayBand = summary?.maxWindInBand;
  const aloft: CompareBoardAloft | null = scopedBand
    ? {
        windMps: scopedBand.windMps,
        directionDeg: scopedBand.directionDeg,
        heightM: scopedBand.heightM,
        at: instant(scopedBand.at),
        scope: "duringWindow",
        /* The window-scoped block states no persistence — null, not 0. */
        persistenceHours: null,
      }
    : wholeDayBand
      ? {
          windMps: wholeDayBand.windMps,
          directionDeg: wholeDayBand.directionDeg,
          heightM: wholeDayBand.heightM,
          at: instant(wholeDayBand.at),
          scope: "wholeDay",
          persistenceHours: wholeDayBand.persistenceHours,
        }
      : null;

  const top = buildTop(analysis, day, instant);
  const vote = buildVote(analysis, benched, touchesDay, quiet, day);

  return {
    member,
    model: analysis.model,
    referenceTime: analysis.run.referenceTime,
    kind: analysis.deterministic ? "deterministic" : "ensemble",
    stepHours: analysis.stepHours,
    vote,
    windows,
    exceedances,
    overCeiling,
    rainStart,
    launch,
    gust,
    aloft,
    top,
    storms,
  };
}

function buildTop(
  analysis: ForecastAnalysis,
  day: DayContext,
  instant: (at: CitedInstant) => BoardInstant,
): CompareBoardTop | null {
  /* The top cell reads day-keyed windows only: a via-window's peak
     describes the whole window, and citing it as this day's top would
     claim a number the day may never reach. */
  const dayWindows = analysis.findings.filter(
    (finding): finding is ThermalWindowFinding =>
      finding.kind === "thermalWindow" && finding.day === day.dateKey,
  );
  if (dayWindows.length === 0) return null;
  const peakWindow = dayWindows.reduce((best, window) =>
    window.peakLiftTopM > best.peakLiftTopM ? window : best,
  );
  const ceiling = analysis.findings.find(
    (finding): finding is LiftCeilingFinding =>
      finding.kind === "liftCeiling" && finding.day === day.dateKey,
  );
  let cloudCapped: boolean | null = null;
  let cloudCappedHours = 0;
  let ceilingHours = 0;
  if (ceiling) {
    const peakAt = peakWindow.peakLiftTopAt.validAt;
    for (const segment of ceiling.segments) {
      ceilingHours += segment.hoursN;
      if (segment.cause === "cloudCapped") cloudCappedHours += segment.hoursN;
      if (segment.start.validAt <= peakAt && peakAt <= segment.end.validAt) {
        cloudCapped = segment.cause === "cloudCapped";
      }
    }
  }
  return {
    liftTopM: peakWindow.peakLiftTopM,
    aboveLaunchM: peakWindow.peakLiftTopAboveLaunchM,
    at: instant(peakWindow.peakLiftTopAt),
    cloudCapped,
    cloudCappedHours,
    ceilingHours,
  };
}

function buildStorms(
  capTiming: CapTimingFinding | undefined,
  convective: ConvectiveDayFinding | undefined,
  analysis: ForecastAnalysis,
  instant: (at: CitedInstant) => BoardInstant,
  axis: CompareBoardAxis,
): CompareBoardStorms | null {
  if (capTiming) {
    let capBreak: CompareBoardStorms["capBreak"] = null;
    const breakSpan = (
      kind: "at" | "between" | "alreadyOpenAt",
      start: CitedInstant,
      end: CitedInstant,
      widened: boolean,
    ) => {
      const startMs = Date.parse(start.validAt);
      const endMs = Date.parse(end.validAt) + (widened ? stepMs(capTiming.stepHours) : 0);
      return {
        kind,
        x0: xForBoardTime(axis, startMs),
        x1: xForBoardTime(axis, endMs),
        startMs,
        endMs,
        start,
        end,
      };
    };
    if (capTiming.capBreaksAt) {
      capBreak = breakSpan("at", capTiming.capBreaksAt, capTiming.capBreaksAt, true);
    } else if (capTiming.capBreaksBetween) {
      /* The interval is a bound between two real published steps — its
         far edge is the "by" step itself, never widened past it. */
      capBreak = breakSpan(
        "between",
        capTiming.capBreaksBetween.after,
        capTiming.capBreaksBetween.by,
        false,
      );
    } else if (capTiming.capAlreadyOpenAt) {
      capBreak = breakSpan(
        "alreadyOpenAt",
        capTiming.capAlreadyOpenAt,
        capTiming.capAlreadyOpenAt,
        true,
      );
    }
    return {
      source: "capTiming",
      verdict: capTiming.verdict,
      cadence: capTiming.cadence,
      stepHours: capTiming.stepHours,
      peakCapeJkg: capTiming.peakCapeJkg,
      peakCapeAt: capTiming.peakCapeAt ? instant(capTiming.peakCapeAt) : null,
      capBreak,
      capeAtBreakJkg: capTiming.capeAtBreakJkg ?? null,
      precipStartsAt: capTiming.precipStartsAt ? instant(capTiming.precipStartsAt) : null,
      peakPrecipMmHr: capTiming.peakPrecipMmHr ?? null,
      precipSemantics: capTiming.precipSemantics ?? null,
      noPrecipAboveThreshold: false,
    };
  }
  if (!convective) return null;
  /* A truncated day's CAPE peak is routinely nocturnal — real numbers, an
     artifact as a soaring statement — so a sliver states nothing. */
  if (convective.coverage.truncated) return null;
  return {
    source: "convectiveDay",
    /* The stating floor is the analysis's own instability floor — the
       same number capTiming's noInstability verdict reads. */
    verdict:
      convective.peakCapeJkg < analysis.thresholds.capTiming.instabilityMinCapeJkg
        ? "noInstability"
        : "capUnjudgeable",
    cadence: "hourly",
    stepHours: convective.stepHours,
    peakCapeJkg: convective.peakCapeJkg,
    peakCapeAt: convective.peakCapeAt ? instant(convective.peakCapeAt) : null,
    capBreak: null,
    capeAtBreakJkg: null,
    precipStartsAt: convective.precipStartsAt ? instant(convective.precipStartsAt) : null,
    peakPrecipMmHr: convective.peakPrecipMmHr ?? null,
    precipSemantics: convective.precipSemantics ?? null,
    noPrecipAboveThreshold: convective.noPrecipAboveThreshold === true,
  };
}

function buildVote(
  analysis: ForecastAnalysis,
  benched: { reason: "terrainMismatch"; deltaM: number } | null,
  touchesDay: boolean,
  quiet: QuietDayFinding | undefined,
  day: DayContext,
): CompareBoardVote {
  /* A benched member appears in no roster — the ledger's reason is its
     one statement for every day. */
  if (benched) return { kind: "benched", reason: "terrainMismatch", deltaM: benched.deltaM };
  if (touchesDay) {
    const crossing = analysis.findings.find(
      (finding): finding is PercentileCrossingFinding =>
        finding.kind === "percentileCrossing" && finding.day === day.dateKey,
    );
    return { kind: "window", minimalPassingPercentile: crossing?.minimalPassingPercentile ?? null };
  }
  if (quiet) {
    if (quiet.coverage.truncated) return { kind: "abstained", reason: "truncatedDay" };
    return {
      kind: "quiet",
      failed: quiet.failed,
      peakThermalVelocityMps: quiet.peakThermalVelocityMps,
      peakLiftDepthM: quiet.peakLiftDepthM,
    };
  }
  if (!analysis.coveredDays.includes(day.dateKey)) {
    return { kind: "abstained", reason: "outOfHorizon" };
  }
  /* Unreachable by the vocabulary's construction: every covered day
     without a window carries a quietDay. Reaching here means the
     vocabulary changed under this module. */
  throw new Error(
    `buildCompareBoardScene: member ${analysis.model} covers ${day.dateKey} yet states neither a window nor a quiet day — the analyze vocabulary changed under compare-board`,
  );
}
