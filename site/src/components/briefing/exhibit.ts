/* Build-time derivations for the /briefing/ exhibits. Every number the
   page prints is interpolated from the package's own output — analyzeForecast
   and compareForecasts over the scenario registry's generated profiles, and
   the history reader over the sample dataset's own archive bytes — nothing
   is typed in by hand. Pure functions over committed inputs, so the page
   can only show what the package actually said. */

import { readFileSync } from "node:fs";
import {
  analyzeForecast,
  type ForecastAnalysis,
  type ForecastFinding,
  type LiftCeilingFinding,
  type ThermalWindowFinding,
  type WindCeilings,
} from "@azohra/meteo.briefing/analyze";
import {
  compareForecasts,
  type HeightSpreadFinding,
  type WindDirectionSpreadFinding,
  type WindowAgreementFinding,
} from "@azohra/meteo.briefing/compare";
import { parseSiteForecastJson, siteForecastSchema } from "@azohra/meteo.briefing/contract";
import { parseHistoryIndexJson, splitHistoryArchive } from "@azohra/meteo.briefing/history";
import { scenarioById, type TeachingScenario } from "../../lib/scenarios";

export function fail(message: string): never {
  throw new Error(`[briefing page] ${message}`);
}

/** "2000-01-01T14:00" → "14:00" — the findings' local instants, as clocks. */
export const clock = (instant: { local: string }): string => instant.local.slice(11);

/* ---- the day: one profile, read as findings ----
   The ceilings are analysis inputs, not weather: windExceedance emits only
   against caller-owned numbers, because the package deliberately owns no
   "safe wind" figure (AnalyzeOptions.windCeilings has no defaults). */

export const DAY_WIND_CEILINGS = {
  surfaceMps: 6,
  bandMps: 8,
} as const satisfies WindCeilings;

export interface BriefingDay {
  scenario: TeachingScenario;
  analysis: ForecastAnalysis;
  window: ThermalWindowFinding;
  ceiling: LiftCeilingFinding;
  /** `analysis.findings.indexOf(ceiling)` — the hero panel's comment cites it. */
  ceilingIndex: number;
}

export function briefingDay(): BriefingDay {
  const scenario = scenarioById("cloud-base-limits-lift");
  const analysis = analyzeForecast(scenario.profile, {
    timeZone: scenario.timeZone,
    launch: scenario.launch,
    windCeilings: DAY_WIND_CEILINGS,
  });
  const window =
    analysis.findings.find(
      (finding): finding is ThermalWindowFinding => finding.kind === "thermalWindow",
    ) ?? fail("the day emits no thermalWindow finding");
  const ceiling =
    analysis.findings.find(
      (finding): finding is LiftCeilingFinding => finding.kind === "liftCeiling",
    ) ?? fail("the day emits no liftCeiling finding");
  if (ceiling.segments[0]?.cause !== "cloudCapped") {
    fail("the day's lift ceiling is no longer cloud-capped — re-choose the hero scenario");
  }
  return { scenario, analysis, window, ceiling, ceilingIndex: analysis.findings.indexOf(ceiling) };
}

/* ---- each finding, restated as one sentence carrying its own numbers ---- */

export interface FindingRow {
  kind: ForecastFinding["kind"];
  term: string;
  statement: string;
}

export function findingRow(finding: ForecastFinding): FindingRow | null {
  switch (finding.kind) {
    case "thermalWindow": {
      const aboveLaunch =
        finding.peakLiftTopAboveLaunchM === null
          ? ""
          : ` — ${finding.peakLiftTopAboveLaunchM} m above launch`;
      const clipped =
        finding.clippedAtStart && finding.clippedAtEnd
          ? ", open at both edges of the document's horizon"
          : "";
      return {
        kind: finding.kind,
        term: "Thermal window",
        statement: `${clock(finding.start)}–${clock(finding.end)}, ${finding.durationHours} h of usable lift${clipped}. Peak climb ${finding.peakThermalVelocityMps} m/s; the lift tops out at ${finding.peakLiftTopM} m at ${clock(finding.peakLiftTopAt)}${aboveLaunch}.`,
      };
    }
    case "liftCeiling": {
      const statements = finding.segments.map((segment) => {
        const evidence = segment.evidence;
        const cause =
          segment.cause === "cloudCapped"
            ? `Cloud base caps the climb from ${clock(segment.start)} to ${clock(segment.end)}`
            : `Updraft decay, not cloud, sets the top from ${clock(segment.start)} to ${clock(segment.end)}`;
        const boundaryLayer =
          evidence.boundaryLayerTopM === null
            ? ""
            : `, while the heated boundary layer reaches ${evidence.boundaryLayerTopM} m`;
        return `${cause}: usable lift peaks at ${evidence.peakUsableLiftTopM} m under a ${evidence.cloudBaseM} m cloud base${boundaryLayer}.`;
      });
      if (statements.length === 0) return null;
      return { kind: finding.kind, term: "Lift ceiling", statement: statements.join(" ") };
    }
    case "windSummary": {
      const parts: string[] = [];
      if (finding.maxWindInBand) {
        const band = finding.maxWindInBand;
        const direction = band.directionDeg === null ? "" : ` from ${band.directionDeg}°`;
        parts.push(
          `Strongest wind in the climb band: ${band.windMps} m/s${direction} at ${band.heightM} m, ${clock(band.at)}.`,
        );
      }
      if (finding.maxGust) {
        const gust = finding.maxGust;
        const mean = gust.meanWindMps === null ? "" : ` over a ${gust.meanWindMps} m/s mean`;
        parts.push(`Peak gust ${gust.gustMps} m/s at ${clock(gust.at)}${mean}.`);
      }
      if (parts.length === 0) return null;
      return { kind: finding.kind, term: "Wind", statement: parts.join(" ") };
    }
    case "windExceedance": {
      const term =
        finding.quantity === "surfaceWind"
          ? "Surface-wind ceiling"
          : finding.quantity === "bandWind"
            ? "Band-wind ceiling"
            : "Gust ceiling";
      const runs = finding.runs.map(
        (run) =>
          `${clock(run.start)}–${clock(run.end)} (${run.hours} h), peaking ${run.peakMps} m/s at ${clock(run.peakAt)}`,
      );
      if (runs.length === 0) return null;
      return {
        kind: finding.kind,
        term,
        statement: `Above your ${finding.thresholdMps} m/s ceiling ${runs.join("; ")}.`,
      };
    }
    case "windDirection": {
      const surface = finding.surface;
      const parts: string[] = [];
      if (
        finding.netVeerDeg !== null &&
        surface.start.directionDeg !== null &&
        surface.end.directionDeg !== null
      ) {
        parts.push(
          `Surface flow veers ${finding.netVeerDeg}° across the window — ${surface.start.directionDeg}° at ${surface.start.speedMps} m/s opening, ${surface.end.directionDeg}° at ${surface.end.speedMps} m/s closing.`,
        );
      }
      if (finding.bandVectorMean && finding.bandVectorMean.directionDeg !== null) {
        parts.push(
          `The climb band averages ${finding.bandVectorMean.directionDeg}° at ${finding.bandVectorMean.speedMps} m/s.`,
        );
      }
      if (parts.length === 0) return null;
      return { kind: finding.kind, term: "Wind direction", statement: parts.join(" ") };
    }
    case "bandShear": {
      const max = finding.maxShear;
      return {
        kind: finding.kind,
        term: "Shear in the climb band",
        statement: `Strongest layer shear ${max.shearMps} m/s across ${max.layer.fromM}–${max.layer.toM} m at ${clock(max.at)} — ${max.ratePerKm} m/s per km, from ${max.lower.speedMps} m/s at ${max.lower.directionDeg}° up to ${max.upper.speedMps} m/s at ${max.upper.directionDeg}°.`,
      };
    }
    case "dataCaveats": {
      const parts = finding.caveats.map((caveat) => {
        switch (caveat.caveat) {
          case "absentQuantities":
            return `this model never publishes ${caveat.quantities.join(", ")} — those read as absent, not zero`;
          case "derivedNullHours":
            return `${caveat.quantity} is null for ${caveat.hoursNull} of ${caveat.ofHours} hours — a forecast of none, not a gap`;
          case "stepCadence":
            return `${caveat.stepHours} h steps — timing finer than the cadence is interpolation`;
          case "timesAreUtc":
            return "no document timezone, so local times read in UTC";
        }
      });
      return {
        kind: finding.kind,
        term: "Data caveats",
        statement: `${parts.join("; ").replace(/^./, (c) => c.toUpperCase())}.`,
      };
    }
    default:
      /* Kinds this profile never emits (smoke, cap timing, ensemble kinds …). */
      return null;
  }
}

export function findingRows(analysis: ForecastAnalysis): FindingRow[] {
  const rows = analysis.findings.map(findingRow).filter((row): row is FindingRow => row !== null);
  if (rows.length === 0) fail("analyzeForecast produced no renderable findings");
  return rows;
}

/* ---- two members over one day: the controlled timing pair ----
   The comparison scenario's two profiles share one model slug and
   referenceTime by construction, and a member is a (model, referenceTime)
   run — so each document is re-slugged through the contract schema before
   it joins, the same re-slug the compare docs figure applies
   (internal/doc-figures/page-figures.mjs), keeping each member's own
   analysis. Nothing else about either document changes. */

export interface TimingComparison {
  earlier: TeachingScenario;
  later: TeachingScenario;
  agreement: WindowAgreementFinding;
  heights: HeightSpreadFinding;
  directions: WindDirectionSpreadFinding;
  /** The one unclipped window start among the members' votes. */
  statedStart: { model: string; at: string };
  votes: { model: string; window: string; peakMps: number; clipped: boolean }[];
}

export function timingComparison(): TimingComparison {
  const earlier = scenarioById("model-timing-disagreement", "earlier");
  const later = scenarioById("model-timing-disagreement", "later");
  if (earlier.timeZone !== later.timeZone) fail("the timing pair no longer shares a timezone");
  const relabel = (scenario: TeachingScenario, model: string) =>
    siteForecastSchema.parse({ ...scenario.profile, model });
  const comparison = compareForecasts([relabel(earlier, "earlier"), relabel(later, "later")], {
    timeZone: earlier.timeZone,
    launch: earlier.launch,
  });

  const agreement =
    comparison.findings.find(
      (finding): finding is WindowAgreementFinding => finding.kind === "windowAgreement",
    ) ?? fail("the timing pair emits no windowAgreement finding");
  if (agreement.voters !== 2 || agreement.unanimous !== true) {
    fail("the timing pair's windowAgreement is no longer a unanimous two-voter day");
  }
  if (agreement.timing.startSpreadHours !== null || agreement.timing.starts.length !== 1) {
    fail("the timing pair no longer has exactly one unclipped start — rewrite the exhibit copy");
  }
  const heights =
    comparison.findings.find(
      (finding): finding is HeightSpreadFinding => finding.kind === "heightSpread",
    ) ?? fail("the timing pair emits no heightSpread finding");
  const directions =
    comparison.findings.find(
      (finding): finding is WindDirectionSpreadFinding => finding.kind === "windDirectionSpread",
    ) ?? fail("the timing pair emits no windDirectionSpread finding");

  const start = agreement.timing.starts[0];
  const votes = agreement.windows.map((vote) => ({
    model: vote.model,
    window: `${clock(vote.start)}–${clock(vote.end)}`,
    peakMps: vote.peakThermalVelocityMps,
    clipped: vote.clippedAtStart,
  }));
  return {
    earlier,
    later,
    agreement,
    heights,
    directions,
    statedStart: { model: start.model, at: clock(start.at) },
    votes,
  };
}

/* ---- the sample archive: one site's month of published runs ---- */

export interface ArchivedRun {
  byteOffset: number;
  byteLength: number;
  lines: number;
  model: string;
  referenceTime: string;
  generatedAt: string;
  siteName: string;
  hours: number;
}

export interface SampleArchive {
  path: string;
  bytes: number;
  runs: ArchivedRun[];
  indexPath: string;
}

export function sampleArchive(): SampleArchive {
  const directory = new URL(
    "../../../public/data-sample/hrdps-continental/history/test-hill/",
    import.meta.url,
  );
  const bytes = readFileSync(new URL("2026-08.jsonl.gz", directory));
  const members =
    splitHistoryArchive(new Uint8Array(bytes)) ?? fail("the sample month archive failed to split");
  const index =
    parseHistoryIndexJson(readFileSync(new URL("2026-08.index.json", directory), "utf8")) ??
    fail("the sample archive's sidecar index failed to parse");
  if (index.members.length !== members.length) {
    fail("the sidecar index and the archive disagree about member count");
  }

  const runs = members.map((member, position) => {
    const sidecar = index.members[position];
    if (sidecar.byteOffset !== member.byteOffset || sidecar.byteLength !== member.byteLength) {
      fail(`the sidecar index misplaces member ${position}`);
    }
    const line = member.lines[0] ?? fail(`archive member ${position} carries no lines`);
    const document =
      parseSiteForecastJson(line) ?? fail(`archive member ${position} fails the contract guard`);
    return {
      byteOffset: member.byteOffset,
      byteLength: member.byteLength,
      lines: member.lines.length,
      model: document.model,
      referenceTime: document.run.referenceTime,
      generatedAt: document.run.generatedAt,
      siteName: document.site.name,
      hours: document.hours.length,
    };
  });
  if (runs.length === 0) fail("the sample archive holds no runs");

  return {
    path: "data-sample/hrdps-continental/history/test-hill/2026-08.jsonl.gz",
    bytes: bytes.length,
    runs,
    indexPath: "2026-08.index.json",
  };
}
