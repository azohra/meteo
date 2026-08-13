import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_FRAME_VERSION,
  ANALYZE_VOCABULARY_VERSION,
  analyzeForecast,
  DEFAULT_ANALYZE_THRESHOLDS,
  type AnalysisExtension,
  type BandShearFinding,
  type CapTimingFinding,
  type ConvectiveDayFinding,
  type DataCaveatsFinding,
  type EnsembleMembershipFinding,
  type ThermalWindowFinding,
  type LiftCeilingFinding,
  type PercentileCrossingFinding,
  type QuietDayFinding,
  type SmokeImpactFinding,
  type SmokeImpactJoinedFinding,
  type SmokeImpactProfileFinding,
  type TerrainMismatchFinding,
  type WindDirectionFinding,
  type WindExceedanceFinding,
  type WindSummaryFinding,
} from "../src/analyze/index.js";
import {
  parseSmokeDocument,
  parseSiteForecast,
  type SmokeDocument,
  type SiteForecast,
} from "../src/contract.js";

const fixtures = JSON.parse(
  readFileSync(join(__dirname, "analyze-fixtures.json"), "utf-8"),
) as Record<string, unknown>;

function load(key: string): SiteForecast {
  const profile = parseSiteForecast(fixtures[key]);
  expect(profile, `${key} must satisfy the published contract`).not.toBeNull();
  return profile!;
}

const hrrr = () => load("hrrrConusErie");
const geps = () => load("gepsFlagpole");
const reps = () => load("repsErie");

const ERIE = { launch: { elevationM: 1247 } };
const FLAGPOLE = { launch: { elevationM: 1222 } };

function ofKind<T extends { kind: string }>(
  findings: readonly { kind: string }[],
  kind: T["kind"],
): T[] {
  return findings.filter((finding) => finding.kind === kind) as T[];
}

type Ev = {
  members: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  ceiledMembers?: number;
};
function ev(
  p10: number,
  p25: number,
  p50: number,
  p75: number,
  p90: number,
  members = 21,
  ceiledMembers?: number,
): Ev {
  const value: Ev = { members, p10, p25, p50, p75, p90 };
  if (ceiledMembers !== undefined) value.ceiledMembers = ceiledMembers;
  return value;
}
const quietWstar = () => ev(0.1, 0.15, 0.2, 0.3, 0.4);
const quietTop = () => ev(1300, 1350, 1400, 1450, 1500);

function crossingFixture(): SiteForecast {
  const doc = JSON.parse(JSON.stringify(fixtures["repsErie"])) as {
    hours: Array<{ validAt: string; derived: Record<string, unknown> }>;
  };
  const template = JSON.stringify(doc.hours[0]);
  const hour = (validAt: string, wstar: Ev, top: Ev) => {
    const clone = JSON.parse(template) as (typeof doc.hours)[number];
    clone.validAt = validAt;
    clone.derived.thermalVelocityMps = wstar;
    clone.derived.usableLiftTopM = top;
    return clone;
  };
  doc.hours = [
    hour("2026-08-09T18:00:00Z", quietWstar(), quietTop()),
    hour(
      "2026-08-09T21:00:00Z",
      ev(0.5, 0.95, 1.2, 1.5, 1.8),
      ev(1500, 1600, 1900, 2200, 2500, 21, 0),
    ),
    hour("2026-08-10T00:00:00Z", quietWstar(), quietTop()),
    hour("2026-08-10T03:00:00Z", quietWstar(), quietTop()),
    hour("2026-08-10T06:00:00Z", quietWstar(), quietTop()),
    hour("2026-08-10T09:00:00Z", quietWstar(), quietTop()),
    hour("2026-08-10T12:00:00Z", quietWstar(), quietTop()),
    hour(
      "2026-08-10T18:00:00Z",
      ev(0.3, 0.5, 0.7, 1.1, 1.4),
      ev(1200, 1300, 1400, 1800, 2200, 18, 0),
    ),
    hour(
      "2026-08-11T00:00:00Z",
      ev(0.2, 0.4, 0.6, 0.85, 1.0),
      ev(1100, 1200, 1300, 1900, 2000, 21, 1),
    ),
    hour("2026-08-11T06:00:00Z", quietWstar(), quietTop()),
    hour("2026-08-11T12:00:00Z", quietWstar(), quietTop()),
    hour("2026-08-11T18:00:00Z", ev(1.0, 1.2, 1.5, 1.8, 2.0), ev(1600, 1700, 1900, 2100, 2300)),
  ];
  const profile = parseSiteForecast(doc);
  expect(profile).not.toBeNull();
  return profile!;
}

describe("the analysis envelope", () => {
  it("stamps the vocabulary version and the document's identity", () => {
    const analysis = analyzeForecast(hrrr(), ERIE);
    expect(analysis.vocabularyVersion).toBe(ANALYZE_VOCABULARY_VERSION);
    expect(analysis.model).toBe("hrrr-conus");
    expect(analysis.site).toEqual({ id: "erie", launchAltitudeM: 1247, modelElevationM: 1177.6 });
    expect(analysis.run.referenceTime).toBe("2026-08-08T18:00:00Z");
    expect(analysis.stepHours).toBe(1);
    expect(analysis.hours).toBe(24);
  });

  it("self-describes for comparison — resolved thresholds, deterministic, covered days", () => {
    const analysis = analyzeForecast(hrrr(), {
      ...ERIE,
      thresholds: { thermalWindow: { wstarMinMps: 1.0 } },
    });
    expect(analysis.deterministic).toBe(true);
    expect(analysis.thresholds).toEqual({
      ...DEFAULT_ANALYZE_THRESHOLDS,
      thermalWindow: { ...DEFAULT_ANALYZE_THRESHOLDS.thermalWindow, wstarMinMps: 1.0 },
    });
    expect(analysis.coveredDays).toEqual(["2026-08-08", "2026-08-09"]);
    const reps_ = analyzeForecast(reps(), ERIE);
    expect(reps_.thresholds).toEqual(DEFAULT_ANALYZE_THRESHOLDS);
    expect(reps_.deterministic).toBe(false);
  });

  it("computes coveredDays in the envelope's own zone — the same hours, different days", () => {
    const analysis = analyzeForecast(hrrr(), { ...ERIE, timeZone: "Australia/Sydney" });
    expect(analysis.coveredDays).toEqual(["2026-08-09", "2026-08-10"]);
  });

  it("reads local time from the document's own site.timeZone", () => {
    const analysis = analyzeForecast(hrrr(), ERIE);
    expect(analysis.timeZone).toBe("America/Vancouver");
    expect(analysis.timeZoneSource).toBe("document");
  });

  it("lets the caller override the timezone", () => {
    const analysis = analyzeForecast(hrrr(), { ...ERIE, timeZone: "America/Edmonton" });
    expect(analysis.timeZone).toBe("America/Edmonton");
    expect(analysis.timeZoneSource).toBe("override");
    const window = ofKind<ThermalWindowFinding>(analysis.findings, "thermalWindow")[0];
    expect(window.start.local).toBe("2026-08-08T13:00");
  });

  it("falls back to UTC when nothing declares a zone, and says so in dataCaveats", () => {
    const undeclared = hrrr();
    delete (undeclared.site as { timeZone?: string }).timeZone;
    const analysis = analyzeForecast(undeclared);
    expect(analysis.timeZone).toBe("UTC");
    expect(analysis.timeZoneSource).toBe("utcFallback");
    const caveats = ofKind<DataCaveatsFinding>(analysis.findings, "dataCaveats")[0];
    expect(caveats.caveats).toContainEqual({ caveat: "timesAreUtc" });
  });

  it("analyzes launch-free when no launch is supplied — the honest fallback", () => {
    const analysis = analyzeForecast(hrrr());
    expect(analysis.site.launchAltitudeM).toBeNull();
    const windows = ofKind<ThermalWindowFinding>(analysis.findings, "thermalWindow");
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      expect(window.peakLiftTopAboveLaunchM).toBeNull();
    }
  });

  it("emits only the versioned vocabulary — kinds are a closed, versioned set", () => {
    const kinds = new Set(
      [
        analyzeForecast(hrrr(), ERIE),
        analyzeForecast(geps(), FLAGPOLE),
        analyzeForecast(reps(), ERIE),
      ].flatMap((analysis) => analysis.findings.map((finding) => finding.kind)),
    );
    for (const kind of kinds) {
      expect([
        "terrainMismatch",
        "dataCaveats",
        "ensembleMembership",
        "capTiming",
        "convectiveDay",
        "thermalWindow",
        "percentileCrossing",
        "quietDay",
        "liftCeiling",
        "smokeImpact",
        "windSummary",
        "windExceedance",
        "windDirection",
        "bandShear",
      ]).toContain(kind);
    }
  });
});

describe("thermalWindow", () => {
  it("finds the deterministic afternoon window with local timing and launch-relative peak", () => {
    const findings = ofKind<ThermalWindowFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "thermalWindow",
    );
    const saturday = findings.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.start).toEqual({ validAt: "2026-08-08T19:00:00Z", local: "2026-08-08T12:00" });
    expect(saturday.end).toEqual({ validAt: "2026-08-09T01:00:00Z", local: "2026-08-08T18:00" });
    expect(saturday.durationHours).toBe(7);
    expect(saturday.peakLiftTopM).toBe(2905.6);
    expect(saturday.peakLiftTopAboveLaunchM).toBe(1658.6);
    expect(saturday.peakThermalVelocityMps).toBe(2.16);
    expect(saturday.thresholds).toEqual(DEFAULT_ANALYZE_THRESHOLDS.thermalWindow);
    expect(saturday.evidence.hours).toHaveLength(7);
    expect(saturday.evidence.usableLiftTopM[4]).toBe(2905.6);
    expect(saturday.evidence.liftTopBandP10P90).toBeUndefined();
  });

  it("stamps forecast lead and the cadence echo on every window", () => {
    const hrrrWindows = ofKind<ThermalWindowFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "thermalWindow",
    );
    const saturday = hrrrWindows.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.leadHours).toBe(5);
    expect(saturday.stepHours).toBe(1);
    const sunday = hrrrWindows.find((finding) => finding.day === "2026-08-09")!;
    expect(sunday.leadHours).toBe(24);

    const repsWindows = ofKind<ThermalWindowFinding>(
      analyzeForecast(reps(), ERIE).findings,
      "thermalWindow",
    );
    expect(repsWindows[0].leadHours).toBe(3);
    expect(repsWindows[0].stepHours).toBe(3);
  });

  it("bridges sub-threshold dips only when asked — maxGapHours states the segmentation convention", () => {
    const dipped = hrrr();
    for (const hour of dipped.hours) {
      if (hour.validAt === "2026-08-08T22:00:00Z") {
        (hour.derived as { thermalVelocityMps: number }).thermalVelocityMps = 0.85;
      }
    }
    const split = ofKind<ThermalWindowFinding>(
      analyzeForecast(dipped, ERIE).findings,
      "thermalWindow",
    ).filter((finding) => finding.day === "2026-08-08");
    expect(split.map((finding) => [finding.start.validAt, finding.end.validAt])).toEqual([
      ["2026-08-08T19:00:00Z", "2026-08-08T21:00:00Z"],
      ["2026-08-08T23:00:00Z", "2026-08-09T01:00:00Z"],
    ]);
    const merged = ofKind<ThermalWindowFinding>(
      analyzeForecast(dipped, {
        ...ERIE,
        thresholds: { thermalWindow: { maxGapHours: 1 } },
      }).findings,
      "thermalWindow",
    ).filter((finding) => finding.day === "2026-08-08");
    expect(merged).toHaveLength(1);
    expect(merged[0].start.validAt).toBe("2026-08-08T19:00:00Z");
    expect(merged[0].end.validAt).toBe("2026-08-09T01:00:00Z");
    expect(merged[0].durationHours).toBe(7);
    expect(merged[0].peakLiftTopM).toBe(2905.6);
    const dipIndex = merged[0].evidence.hours.indexOf("2026-08-08T22:00:00Z");
    expect(merged[0].evidence.thermalVelocityMps[dipIndex]).toBe(0.85);
    expect(merged[0].thresholds).toEqual({ wstarMinMps: 0.9, depthMinM: 300, maxGapHours: 1 });
  });

  it("never bridges a data hole — a null hour is not a forecast dip", () => {
    const holed = hrrr();
    for (const hour of holed.hours) {
      if (hour.validAt === "2026-08-08T22:00:00Z") {
        (hour.derived as { usableLiftTopM: number | null }).usableLiftTopM = null;
      }
    }
    const windows = ofKind<ThermalWindowFinding>(
      analyzeForecast(holed, {
        ...ERIE,
        thresholds: { thermalWindow: { maxGapHours: 1 } },
      }).findings,
      "thermalWindow",
    ).filter((finding) => finding.day === "2026-08-08");
    expect(windows.map((finding) => [finding.start.validAt, finding.end.validAt])).toEqual([
      ["2026-08-08T19:00:00Z", "2026-08-08T21:00:00Z"],
      ["2026-08-08T23:00:00Z", "2026-08-09T01:00:00Z"],
    ]);
  });

  it("moves with the caller's thresholds — they are conventions, not physics", () => {
    const strict = analyzeForecast(hrrr(), {
      ...ERIE,
      thresholds: { thermalWindow: { wstarMinMps: 2.1, depthMinM: 1500 } },
    });
    const findings = ofKind<ThermalWindowFinding>(strict.findings, "thermalWindow");
    expect(findings).toHaveLength(1);
    expect(findings[0].durationHours).toBe(1);
    expect(findings[0].start.validAt).toBe("2026-08-08T22:00:00Z");
    expect(findings[0].thresholds).toEqual({ wstarMinMps: 2.1, depthMinM: 1500, maxGapHours: 0 });
  });

  it("states the negative: a day with no window emits quietDay with the numbers that failed", () => {
    const strict = analyzeForecast(hrrr(), {
      ...ERIE,
      thresholds: { thermalWindow: { wstarMinMps: 99, depthMinM: 300 } },
    });
    expect(ofKind<ThermalWindowFinding>(strict.findings, "thermalWindow")).toHaveLength(0);
    const quiet = ofKind<QuietDayFinding>(strict.findings, "quietDay");
    const saturday = quiet.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.failed).toEqual(["wstar"]);
    expect(saturday.peakThermalVelocityMps).toBe(2.16);
    expect(saturday.peakLiftDepthM).toBe(1658.6);
    expect(saturday.peakLiftDepthAt?.validAt).toBe("2026-08-08T23:00:00Z");
    expect(saturday.thresholds).toEqual({ wstarMinMps: 99, depthMinM: 300 });
  });

  it("prints m/s evidence at contract precision — a 0.89 w* under a 0.9 floor says 0.89", () => {
    const profile = hrrr();
    for (const hour of profile.hours) {
      (hour.derived as { thermalVelocityMps: number }).thermalVelocityMps = 0.89;
    }
    const analysis = analyzeForecast(profile, {
      ...ERIE,
      thresholds: { thermalWindow: { wstarMinMps: 0.9, depthMinM: 300 } },
    });
    expect(ofKind<ThermalWindowFinding>(analysis.findings, "thermalWindow")).toHaveLength(0);
    const saturday = ofKind<QuietDayFinding>(analysis.findings, "quietDay").find(
      (finding) => finding.day === "2026-08-08",
    )!;
    expect(saturday.failed).toEqual(["wstar"]);
    expect(saturday.peakThermalVelocityMps).toBe(0.89);
    expect(saturday.peakThermalVelocityMps!).toBeLessThan(saturday.thresholds.wstarMinMps);
  });

  it("flags horizon truncation: a quiet call from a sliver of a day is a data boundary", () => {
    const quiet = ofKind<QuietDayFinding>(analyzeForecast(geps(), FLAGPOLE).findings, "quietDay");
    const byDay = Object.fromEntries(quiet.map((finding) => [finding.day, finding]));
    expect(byDay["2026-08-09"].coverage.truncated).toBe(false);
    expect(byDay["2026-08-09"].coverage.hours).toBe(24);
    expect(byDay["2026-08-08"].coverage.truncated).toBe(true);
    expect(byDay["2026-08-10"].coverage.truncated).toBe(true);
    expect(byDay["2026-08-10"].coverage.hours).toBe(6);
  });

  it("marks windows clipped by the document's own horizon at either edge", () => {
    const windows = ofKind<ThermalWindowFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "thermalWindow",
    );
    const byDay = Object.fromEntries(windows.map((finding) => [finding.day, finding]));
    expect(byDay["2026-08-08"].clippedAtStart).toBe(true);
    expect(byDay["2026-08-08"].clippedAtEnd).toBe(false);
    expect(byDay["2026-08-09"].clippedAtStart).toBe(false);
    expect(byDay["2026-08-09"].clippedAtEnd).toBe(true);
  });

  it("emits no quietDay for a day any window hour touches", () => {
    const findings = analyzeForecast(hrrr(), ERIE).findings;
    const windowDays = new Set(
      ofKind<ThermalWindowFinding>(findings, "thermalWindow").map((finding) => finding.day),
    );
    for (const quiet of ofKind<QuietDayFinding>(findings, "quietDay")) {
      expect(windowDays.has(quiet.day)).toBe(false);
    }
  });

  it("reads ensembles at p50 and carries the p10-p90 lift-top band as evidence", () => {
    const findings = ofKind<ThermalWindowFinding>(
      analyzeForecast(reps(), ERIE).findings,
      "thermalWindow",
    );
    expect(findings.map((finding) => finding.day)).toEqual(["2026-08-08", "2026-08-09"]);
    const saturday = findings[0];
    expect(saturday.durationHours).toBe(3);
    expect(saturday.peakLiftTopM).toBe(2853.2);
    expect(saturday.evidence.liftTopBandP10P90).toEqual([[2732.8, 3006.5]]);
  });

  it("finds nothing at the terrain-mismatch site — lift tops never reach 300 m over launch", () => {
    expect(ofKind(analyzeForecast(geps(), FLAGPOLE).findings, "thermalWindow")).toHaveLength(0);
  });
});

describe("quietDay context — the atmospheric WHY beside the arithmetic why", () => {
  const QUIET = { ...ERIE, thresholds: { thermalWindow: { wstarMinMps: 99 } } };
  const quietDays = (profile: SiteForecast, options: object = QUIET) =>
    ofKind<QuietDayFinding>(analyzeForecast(profile, options).findings, "quietDay");

  it("stamps forecast lead anchored on the day's peak-W* hour", () => {
    const byDay = Object.fromEntries(quietDays(hrrr()).map((finding) => [finding.day, finding]));
    expect(byDay["2026-08-08"].peakThermalVelocityAt?.validAt).toBe("2026-08-08T22:00:00Z");
    expect(byDay["2026-08-08"].leadHours).toBe(4);
    expect(byDay["2026-08-09"].leadHours).toBe(24);
  });

  it("restates cloud, gust, and flux with cited timing — co-timing, never causality", () => {
    const saturday = quietDays(hrrr()).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.context.cloudCoverAtPeakWstarPercent).toBe(100);
    expect(saturday.context.daytimeCloudCoverPercent).toBe(100);
    expect(saturday.context.maxGust).toEqual({
      gustMps: 3.9,
      at: { validAt: "2026-08-08T23:00:00Z", local: "2026-08-08T16:00" },
    });
    expect(saturday.context.peakSensibleHeatFluxWm2).toEqual({
      valueWm2: 280,
      at: { validAt: "2026-08-08T21:00:00Z", local: "2026-08-08T14:00" },
    });
    expect(saturday.context.precipitation).toBeUndefined();
    expect(JSON.stringify(saturday)).not.toMatch(/verdict/i);
  });

  it("carries BOTH the peak-hour cloud sample and the daytime aggregate — either alone misleads", () => {
    const profile = hrrr();
    for (const hour of profile.hours) {
      const surface = hour.surface as { cloudCoverPercent: number };
      if (hour.validAt === "2026-08-08T22:00:00Z") surface.cloudCoverPercent = 12;
      else if (
        [
          "2026-08-08T19:00:00Z",
          "2026-08-08T20:00:00Z",
          "2026-08-08T21:00:00Z",
          "2026-08-08T23:00:00Z",
        ].includes(hour.validAt)
      )
        surface.cloudCoverPercent = 85;
    }
    const saturday = quietDays(profile).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.peakThermalVelocityAt?.validAt).toBe("2026-08-08T22:00:00Z");
    expect(saturday.context.cloudCoverAtPeakWstarPercent).toBe(12);
    expect(saturday.context.daytimeCloudCoverPercent).toBe(70.4);
  });

  it("states the wet day over the embedded floor, with the semantics and step echoes", () => {
    const profile = hrrr();
    const rates: Record<string, number> = {
      "2026-08-08T20:00:00Z": 0.5,
      "2026-08-08T21:00:00Z": 1.2,
      "2026-08-08T22:00:00Z": 0.8,
    };
    for (const hour of profile.hours) {
      const rate = rates[hour.validAt];
      if (rate !== undefined)
        (hour.surface as { precipitationMmHr: number }).precipitationMmHr = rate;
    }
    (profile as { semantics?: object }).semantics = { precipitation: "instantRate" };
    const parsed = parseSiteForecast(profile)!;
    const saturday = quietDays(parsed).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.context.precipitation).toEqual({
      peakMmHr: 1.2,
      peakAt: { validAt: "2026-08-08T21:00:00Z", local: "2026-08-08T14:00" },
      firstWetAt: { validAt: "2026-08-08T20:00:00Z", local: "2026-08-08T13:00" },
      wetHours: 3,
      minMmHr: DEFAULT_ANALYZE_THRESHOLDS.capTiming.precipMinMmHr,
      semantics: "instantRate",
      stepHours: 1,
    });
  });

  it("omits maxGust where the model publishes none — absent is not calm", () => {
    const findings = quietDays(reps());
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.context.maxGust).toBeUndefined();
      expect(finding.context.peakSensibleHeatFluxWm2).toBeDefined();
    }
  });

  it("reads honestly when empty: no atmospheric suppressor stated, the flux was simply weak", () => {
    const profile = hrrr();
    for (const hour of profile.hours) {
      (hour.surface as { cloudCoverPercent: number }).cloudCoverPercent = 0;
    }
    const saturday = quietDays(profile).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.context.precipitation).toBeUndefined();
    expect(saturday.context.cloudCoverAtPeakWstarPercent).toBe(0);
    expect(saturday.context.daytimeCloudCoverPercent).toBe(0);
  });
});

describe("liftCeiling", () => {
  it("attributes the deterministic window's ceiling to sink, citing the segment's peak", () => {
    const findings = ofKind<LiftCeilingFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "liftCeiling",
    );
    const saturday = findings.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.segments).toHaveLength(1);
    expect(saturday.segments[0].cause).toBe("sinkLimited");
    expect(saturday.segments[0].hoursN).toBe(7);
    expect(saturday.segments[0].evidence).toEqual({
      peakUsableLiftTopM: 2905.6,
      peakUsableLiftTopAt: { validAt: "2026-08-08T23:00:00Z", local: "2026-08-08T16:00" },
      cloudBaseM: 3401.7,
      boundaryLayerTopM: 2771.2,
    });
    expect(saturday.thresholds).toEqual(DEFAULT_ANALYZE_THRESHOLDS.liftCeiling);
    expect("flips" in saturday).toBe(false);
  });

  it("calls the REPS windows cloud-capped — base sits on (or within 50 m of) the top", () => {
    const findings = ofKind<LiftCeilingFinding>(
      analyzeForecast(reps(), ERIE).findings,
      "liftCeiling",
    );
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.segments[0].cause).toBe("cloudCapped");
    }
    expect(findings[1].segments[0].evidence.peakUsableLiftTopM).toBe(2543.2);
    expect(findings[1].segments[0].evidence.cloudBaseM).toBe(2543.2);
  });
});

describe("capTiming", () => {
  it("tells the deterministic cap story with local timing and full-day evidence", () => {
    const findings = ofKind<CapTimingFinding>(analyzeForecast(hrrr(), ERIE).findings, "capTiming");
    const saturday = findings.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.verdict).toBe("capBreaks");
    expect(saturday.cadence).toBe("hourly");
    expect(saturday.stepHours).toBe(1);
    expect(saturday.peakCapeJkg).toBe(540);
    expect(saturday.capBreaksAt).toEqual({
      validAt: "2026-08-09T01:00:00Z",
      local: "2026-08-08T18:00",
    });
    expect(saturday.capBreaksBetween).toBeUndefined();
    expect(saturday.capeAtBreakJkg).toBe(540);
    expect(saturday.thermalWindowEndsAt?.local).toBe("2026-08-08T18:00");
    expect(saturday.thresholds).toEqual(DEFAULT_ANALYZE_THRESHOLDS.capTiming);
    expect(saturday.evidence.capeJkg).toContain(540);
    expect(saturday.evidence.hours).toHaveLength(saturday.evidence.cinJkg.length);

    const sunday = findings.find((finding) => finding.day === "2026-08-09")!;
    expect(sunday.verdict).toBe("noInstability");
    expect(sunday.peakCapeJkg).toBe(0);
  });

  it("gates itself off ensembles — a median CIN over half-broken members says neither thing", () => {
    expect(ofKind(analyzeForecast(geps(), FLAGPOLE).findings, "capTiming")).toHaveLength(0);
    expect(ofKind(analyzeForecast(reps(), ERIE).findings, "capTiming")).toHaveLength(0);
  });

  it("splits the old cappedAllDay: an all-day-open cap under the break floor reads openButWeak", () => {
    const profile = hrrr();
    for (const hour of profile.hours) {
      const surface = hour.surface as { capeJkg: number; cinJkg: number };
      if (hour.validAt <= "2026-08-09T06:00:00Z") {
        surface.capeJkg = Math.min(150, surface.capeJkg + 150);
        surface.cinJkg = -5;
      }
    }
    const saturday = ofKind<CapTimingFinding>(
      analyzeForecast(profile, ERIE).findings,
      "capTiming",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.verdict).toBe("openButWeak");
    expect(saturday.peakCapeJkg).toBe(150);
    expect(saturday.capBreaksAt).toBeUndefined();
    for (const cin of saturday.evidence.cinJkg) {
      expect(Math.abs(cin)).toBeLessThan(saturday.thresholds.brokenCapMaxAbsCinJkg);
    }
  });

  it("keeps cappedAllDay for the cap that actually holds", () => {
    const profile = hrrr();
    for (const hour of profile.hours) {
      const surface = hour.surface as { capeJkg: number; cinJkg: number };
      if (hour.validAt <= "2026-08-09T06:00:00Z") {
        surface.capeJkg = 300;
        surface.cinJkg = -80;
      }
    }
    const saturday = ofKind<CapTimingFinding>(
      analyzeForecast(profile, ERIE).findings,
      "capTiming",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.verdict).toBe("cappedAllDay");
  });
});

describe("capTiming at multi-hour cadence — interval verdicts", () => {
  function threeHourly(offset: number, count = 4): SiteForecast {
    const doc = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as { hours: unknown[] };
    doc.hours = Array.from({ length: count }, (_, k) => doc.hours[offset + 3 * k]);
    const profile = parseSiteForecast(doc);
    expect(profile).not.toBeNull();
    return profile!;
  }

  it("re-admits 3-hourly days with an interval between adjacent cited steps", () => {
    const findings = ofKind<CapTimingFinding>(
      analyzeForecast(threeHourly(0), ERIE).findings,
      "capTiming",
    );
    const saturday = findings.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.verdict).toBe("capBreaks");
    expect(saturday.cadence).toBe("multiHour");
    expect(saturday.stepHours).toBe(3);
    expect(saturday.capBreaksAt).toBeUndefined();
    expect(saturday.capBreaksBetween).toEqual({
      after: { validAt: "2026-08-08T22:00:00Z", local: "2026-08-08T15:00" },
      by: { validAt: "2026-08-09T01:00:00Z", local: "2026-08-08T18:00" },
    });
    expect(saturday.capeAtBreakJkg).toBe(540);
    expect(saturday.evidence.hours).toContain("2026-08-08T22:00:00Z");
    expect(saturday.evidence.hours).toContain("2026-08-09T01:00:00Z");
  });

  it("states the day edge as its own case: cap already open at first covered step", () => {
    const doc = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as { hours: unknown[] };
    doc.hours = [doc.hours[6], doc.hours[9]];
    const profile = parseSiteForecast(doc)!;
    const findings = ofKind<CapTimingFinding>(analyzeForecast(profile, ERIE).findings, "capTiming");
    expect(findings).toHaveLength(1);
    expect(findings[0].verdict).toBe("capBreaks");
    expect(findings[0].capAlreadyOpenAt).toEqual({
      validAt: "2026-08-09T01:00:00Z",
      local: "2026-08-08T18:00",
    });
    expect(findings[0].capBreaksBetween).toBeUndefined();
  });

  it("confesses what a multi-hour cappedAllDay is: no PUBLISHED step was broken", () => {
    const findings = ofKind<CapTimingFinding>(
      analyzeForecast(threeHourly(1), ERIE).findings,
      "capTiming",
    );
    const saturday = findings.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.verdict).toBe("cappedAllDay");
    expect(saturday.cadence).toBe("multiHour");
    expect(saturday.peakCapeJkg).toBe(350);
    const hourly = ofKind<CapTimingFinding>(analyzeForecast(hrrr(), ERIE).findings, "capTiming");
    expect(hourly.find((finding) => finding.day === "2026-08-08")!.verdict).toBe("capBreaks");
  });

  it("echoes the precipitation semantics beside the threshold it compares against", () => {
    const doc = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as {
      semantics?: object;
      hours: Array<{ surface: { precipitationMmHr: number } }>;
    };
    doc.semantics = { precipitation: "windowMeanRate" };
    doc.hours[5].surface.precipitationMmHr = 0.85;
    const profile = parseSiteForecast(doc)!;
    const saturday = ofKind<CapTimingFinding>(
      analyzeForecast(profile, ERIE).findings,
      "capTiming",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.precipSemantics).toBe("windowMeanRate");
    expect(saturday.precipStartsAt?.validAt).toBe("2026-08-09T00:00:00Z");
    expect(saturday.peakPrecipMmHr).toBe(0.85);
  });
});

describe("convectiveDay — the CIN-less convective story", () => {
  const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

  function cinless(firstValidAt: string, count: number, capes?: number[]): SiteForecast {
    const doc = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as {
      hours: Array<{ validAt: string; surface: { capeJkg?: number; cinJkg?: number } }>;
    };
    const start = Date.parse(firstValidAt);
    doc.hours = doc.hours.slice(0, count).map((hour, k) => {
      delete hour.surface.cinJkg;
      if (capes) hour.surface.capeJkg = capes[k];
      return { ...hour, validAt: iso(start + k * 3_600_000) };
    });
    const profile = parseSiteForecast(doc);
    expect(profile).not.toBeNull();
    return profile!;
  }

  it("states CAPE magnitude and timing where capTiming is mute, refusing the cap question", () => {
    const profile = cinless("2026-08-08T07:00:00Z", 24);
    const analysis = analyzeForecast(profile, ERIE);
    expect(ofKind(analysis.findings, "capTiming")).toHaveLength(0);
    const findings = ofKind<ConvectiveDayFinding>(analysis.findings, "convectiveDay");
    expect(findings).toHaveLength(1);
    const day = findings[0];
    expect(day.day).toBe("2026-08-08");
    expect(day.peakCapeJkg).toBe(540);
    expect(day.peakCapeAt).toEqual({ validAt: "2026-08-08T13:00:00Z", local: "2026-08-08T06:00" });
    expect(day.capIsJudgeable).toBe(false);
    expect(day.capNotJudgeableReason).toBe("modelPublishesNoCin");
    expect(JSON.stringify(day)).not.toMatch(/verdict/i);
    expect(day.coverage.truncated).toBe(false);
    expect(day.coverage.hours).toBe(24);
    expect(day.stepHours).toBe(1);
    expect(day.thermalWindowEndsAt?.validAt).toBe("2026-08-09T06:00:00Z");
    expect(day.thresholds).toEqual(DEFAULT_ANALYZE_THRESHOLDS.convectiveDay);
    expect(day.evidence.hours).toHaveLength(24);
    expect(day.evidence.capeJkg[6]).toBe(540);
    expect(day.evidence.precipitationMmHr).toHaveLength(24);
  });

  it("states the dry forecast positively — a 0.00 series is a forecast, not absence", () => {
    const day = ofKind<ConvectiveDayFinding>(
      analyzeForecast(cinless("2026-08-08T07:00:00Z", 24), ERIE).findings,
      "convectiveDay",
    )[0];
    expect(day.noPrecipAboveThreshold).toBe(true);
    expect(day.precipStartsAt).toBeUndefined();
    expect(day.peakPrecipMmHr).toBeUndefined();
  });

  it("carries precip timing over the embedded floor, with the semantics echo", () => {
    const profile = cinless("2026-08-08T07:00:00Z", 24);
    const rates: Record<string, number> = {
      "2026-08-08T15:00:00Z": 0.3,
      "2026-08-08T16:00:00Z": 1.46,
      "2026-08-08T17:00:00Z": 0.8,
    };
    for (const hour of profile.hours) {
      const rate = rates[hour.validAt];
      if (rate !== undefined)
        (hour.surface as { precipitationMmHr: number }).precipitationMmHr = rate;
    }
    (profile as { semantics?: object }).semantics = { precipitation: "windowMeanRate" };
    const parsed = parseSiteForecast(profile)!;
    const day = ofKind<ConvectiveDayFinding>(
      analyzeForecast(parsed, ERIE).findings,
      "convectiveDay",
    )[0];
    expect(day.precipStartsAt).toEqual({
      validAt: "2026-08-08T15:00:00Z",
      local: "2026-08-08T08:00",
    });
    expect(day.peakPrecipMmHr).toBe(1.46);
    expect(day.noPrecipAboveThreshold).toBeUndefined();
    expect(day.precipSemantics).toBe("windowMeanRate");
    const strict = ofKind<ConvectiveDayFinding>(
      analyzeForecast(parsed, { ...ERIE, thresholds: { convectiveDay: { precipMinMmHr: 2 } } })
        .findings,
      "convectiveDay",
    )[0];
    expect(strict.noPrecipAboveThreshold).toBe(true);
    expect(strict.thresholds.precipMinMmHr).toBe(2);
  });

  it("confesses the horizon sliver — nocturnal CAPE on a truncated day is not a soaring statement", () => {
    const sliver = cinless("2026-08-12T07:00:00Z", 6, [100, 294, 250, 180, 120, 100]);
    const day = ofKind<ConvectiveDayFinding>(
      analyzeForecast(sliver, ERIE).findings,
      "convectiveDay",
    )[0];
    expect(day.day).toBe("2026-08-12");
    expect(day.peakCapeJkg).toBe(294);
    expect(day.peakCapeAt?.local).toBe("2026-08-12T01:00");
    expect(day.coverage.truncated).toBe(true);
    expect(day.coverage.hours).toBe(6);
  });

  it("emits only where the document publishes CAPE and no CIN — the S4-measured family", () => {
    expect(ofKind(analyzeForecast(hrrr(), ERIE).findings, "convectiveDay")).toHaveLength(0);
    expect(ofKind(analyzeForecast(geps(), FLAGPOLE).findings, "convectiveDay")).toHaveLength(0);
    expect(ofKind(analyzeForecast(reps(), ERIE).findings, "convectiveDay")).toHaveLength(0);
  });
});

describe("windSummary", () => {
  it("states gust and band-wind magnitudes and timing for the deterministic day", () => {
    const findings = ofKind<WindSummaryFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "windSummary",
    );
    const saturday = findings.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.maxGust?.gustMps).toBe(3.9);
    expect(saturday.maxGust?.at.local).toBe("2026-08-08T16:00");
    expect(saturday.maxWindInBand).toMatchObject({
      windMps: 4.28,
      directionDeg: 289,
      heightM: 2581.5,
      pressureHpa: 750,
      persistenceHours: 4,
    });
    expect(saturday.thresholds).toEqual(DEFAULT_ANALYZE_THRESHOLDS.windSummary);
    expect("verdict" in saturday).toBe(false);
  });

  it("omits maxGust where the model publishes none, and carries the semantics echo where it does", () => {
    const findings = ofKind<WindSummaryFinding>(
      analyzeForecast(reps(), ERIE).findings,
      "windSummary",
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.maxGust).toBeUndefined();
      expect(finding.maxWindInBand).toBeDefined();
    }
    const tagged = hrrr();
    (tagged as { semantics?: object }).semantics = {
      gust: "instant",
      precipitation: "instantRate",
    };
    const parsed = parseSiteForecast(tagged)!;
    const summary = ofKind<WindSummaryFinding>(analyzeForecast(parsed).findings, "windSummary")[0];
    expect(summary.maxGust?.semantics).toBe("instant");
  });
});

describe("terrainMismatch", () => {
  it("finds the GEPS flagpole case — model terrain 1,078 m below launch", () => {
    const findings = ofKind<TerrainMismatchFinding>(
      analyzeForecast(geps(), FLAGPOLE).findings,
      "terrainMismatch",
    );
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.modelElevationM).toBe(144.1);
    expect(finding.siteAltitudeM).toBe(1222);
    expect(finding.deltaM).toBe(-1077.9);
    expect(finding.liftTopEverReachesLaunch).toBe(false);
    expect(finding.evidence.maxUsableLiftTopM).toBe(793.7);
    expect(finding.evidence.maxUsableLiftTopAt?.validAt).toBe("2026-08-09T21:00:00Z");
    expect(finding.evidence.maxUsableLiftTopP90M).toBe(809.4);
    expect(finding.thresholds).toEqual(DEFAULT_ANALYZE_THRESHOLDS.terrainMismatch);
  });

  it("stays silent where model terrain sits close to launch", () => {
    expect(ofKind(analyzeForecast(hrrr(), ERIE).findings, "terrainMismatch")).toHaveLength(0);
    expect(ofKind(analyzeForecast(reps(), ERIE).findings, "terrainMismatch")).toHaveLength(0);
  });

  it("says nothing without a launch — there is no launch in the document to mismatch", () => {
    expect(ofKind(analyzeForecast(geps()).findings, "terrainMismatch")).toHaveLength(0);
  });

  it("moves with the caller's threshold", () => {
    const loose = analyzeForecast(hrrr(), {
      ...ERIE,
      thresholds: { terrainMismatch: { minAbsDeltaM: 50 } },
    });
    const findings = ofKind<TerrainMismatchFinding>(loose.findings, "terrainMismatch");
    expect(findings).toHaveLength(1);
    expect(findings[0].deltaM).toBe(-69.4);
    expect(findings[0].liftTopEverReachesLaunch).toBe(true);
    expect(findings[0].evidence.maxUsableLiftTopP90M).toBeNull();
  });
});

describe("ensembleMembership", () => {
  it("surfaces the GEPS CAPE member-dropout landmine per quantity", () => {
    const findings = ofKind<EnsembleMembershipFinding>(
      analyzeForecast(geps(), FLAGPOLE).findings,
      "ensembleMembership",
    );
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.declaredMembers).toBe(21);
    const cape = finding.membership.find((entry) => entry.quantity === "capeJkg")!;
    expect(cape.minMembers).toBe(5);
    expect(cape.hoursBelowFull).toBe(10);
    expect(cape.ofHours).toBe(14);
    expect(cape.evidence.examples.length).toBeGreaterThan(0);
    expect(cape.evidence.examples[0]).toEqual({ validAt: "2026-08-09T06:00:00Z", members: 18 });
  });

  it("states band-width magnitude with no trend verdict and no relative-spread pointer", () => {
    const finding = ofKind<EnsembleMembershipFinding>(
      analyzeForecast(reps(), ERIE).findings,
      "ensembleMembership",
    )[0];
    const liftBand = finding.bands.find((entry) => entry.series === "usableLiftTopM")!;
    expect(liftBand.hoursWithSignal).toBe(4);
    expect(liftBand.medianBandWidth).toBe(287.8);
    expect(liftBand).not.toHaveProperty("trend");
    expect(liftBand).not.toHaveProperty("thresholds");
    expect(liftBand).not.toHaveProperty("maxRelativeSpread");
    expect(liftBand).not.toHaveProperty("maxSpreadAt");
    expect(DEFAULT_ANALYZE_THRESHOLDS).not.toHaveProperty("ensembleMembership");
    expect(JSON.stringify(finding)).not.toMatch(/confidence/i);
  });

  it("carries the per-day band-width series at each day's peak-p50-w* hour", () => {
    const finding = ofKind<EnsembleMembershipFinding>(
      analyzeForecast(reps(), ERIE).findings,
      "ensembleMembership",
    )[0];
    expect(finding.dayBands).toEqual([
      {
        day: "2026-08-08",
        peakHour: { validAt: "2026-08-08T21:00:00Z", local: "2026-08-08T14:00" },
        leadHours: 3,
        wstarBandWidthMps: 0.26,
        liftTopBandWidthM: 273.7,
        truncated: true,
      },
      {
        day: "2026-08-09",
        peakHour: { validAt: "2026-08-09T18:00:00Z", local: "2026-08-09T11:00" },
        leadHours: 24,
        wstarBandWidthMps: 0.17,
        liftTopBandWidthM: 287.8,
        truncated: true,
      },
    ]);
  });

  it("reads day coverage at the day's own cadence and flags horizon stubs", () => {
    const finding = ofKind<EnsembleMembershipFinding>(
      analyzeForecast(crossingFixture(), ERIE).findings,
      "ensembleMembership",
    )[0];
    const byDay = Object.fromEntries(finding.dayBands.map((row) => [row.day, row]));
    expect(byDay["2026-08-10"]).toEqual({
      day: "2026-08-10",
      peakHour: { validAt: "2026-08-10T18:00:00Z", local: "2026-08-10T11:00" },
      leadHours: 48,
      wstarBandWidthMps: 1.1,
      liftTopBandWidthM: 1000,
      truncated: false,
    });
    expect(byDay["2026-08-09"].truncated).toBe(true);
    expect(byDay["2026-08-09"].wstarBandWidthMps).toBe(1.3);
    expect(byDay["2026-08-09"].liftTopBandWidthM).toBe(1000);
    expect(byDay["2026-08-09"].leadHours).toBe(27);
    expect(byDay["2026-08-11"].truncated).toBe(true);
    expect(byDay["2026-08-11"].wstarBandWidthMps).toBe(1);
    expect(byDay["2026-08-11"].liftTopBandWidthM).toBe(700);
  });

  it("says nothing about deterministic documents", () => {
    expect(ofKind(analyzeForecast(hrrr(), ERIE).findings, "ensembleMembership")).toHaveLength(0);
  });
});

describe("mixed cadence — spacing is per-gap, never a document constant", () => {
  const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

  function gepsSwitching(): SiteForecast {
    const doc = JSON.parse(JSON.stringify(fixtures["gepsFlagpole"])) as {
      hours: Array<{ validAt: string }>;
    };
    const head = doc.hours.slice(0, 10);
    const anchor = Date.parse(head[9].validAt);
    const tail = doc.hours
      .slice(10, 16)
      .map((hour, k) => ({ ...hour, validAt: iso(anchor + (k + 1) * 6 * 3_600_000) }));
    doc.hours = [...head, ...tail];
    const profile = parseSiteForecast(doc);
    expect(profile).not.toBeNull();
    return profile!;
  }

  function hrrrWidening(): SiteForecast {
    const doc = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as {
      hours: unknown[];
    };
    doc.hours = [
      ...doc.hours.slice(0, 7),
      doc.hours[9],
      doc.hours[12],
      doc.hours[15],
      doc.hours[18],
      doc.hours[21],
    ];
    const profile = parseSiteForecast(doc);
    expect(profile).not.toBeNull();
    return profile!;
  }

  it("keeps the envelope's stepHours as the leading cadence and confesses the widest step", () => {
    const analysis = analyzeForecast(gepsSwitching(), FLAGPOLE);
    expect(analysis.stepHours).toBe(3);
    const caveats = ofKind<DataCaveatsFinding>(analysis.findings, "dataCaveats")[0];
    expect(caveats.caveats).toContainEqual({ caveat: "stepCadence", stepHours: 6 });
  });

  it("judges quiet-day truncation at the day's own cadence — a covered 6-hourly day is no data boundary", () => {
    const quiet = ofKind<QuietDayFinding>(
      analyzeForecast(gepsSwitching(), FLAGPOLE).findings,
      "quietDay",
    );
    const byDay = Object.fromEntries(quiet.map((finding) => [finding.day, finding]));
    expect(byDay["2026-08-10"].coverage.truncated).toBe(false);
    expect(byDay["2026-08-10"].coverage.hours).toBe(24);
    expect(byDay["2026-08-09"].coverage.truncated).toBe(false);
    expect(byDay["2026-08-09"].coverage.hours).toBe(27);
    expect(byDay["2026-08-08"].coverage.truncated).toBe(true);
    expect(byDay["2026-08-08"].coverage.hours).toBe(18);
  });

  it("counts durationHours as covered span at the actual cadence", () => {
    const windows = ofKind<ThermalWindowFinding>(
      analyzeForecast(hrrrWidening(), ERIE).findings,
      "thermalWindow",
    );
    const saturday = windows.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.evidence.hours).toHaveLength(7);
    expect(saturday.start.validAt).toBe("2026-08-08T19:00:00Z");
    expect(saturday.end.validAt).toBe("2026-08-09T01:00:00Z");
    expect(saturday.durationHours).toBe(9);
    expect(saturday.stepHours).toBe(3);
  });

  it("branches capTiming per day — a day whose rows widen mid-horizon reads interval semantics", () => {
    for (const finding of ofKind<CapTimingFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "capTiming",
    )) {
      expect(finding.cadence).toBe("hourly");
    }
    const widened = ofKind<CapTimingFinding>(
      analyzeForecast(hrrrWidening(), ERIE).findings,
      "capTiming",
    );
    expect(widened).toHaveLength(2);
    const saturday = widened.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.cadence).toBe("multiHour");
    expect(saturday.stepHours).toBe(3);
    expect(saturday.verdict).toBe("capBreaks");
    expect(saturday.capBreaksBetween).toEqual({
      after: { validAt: "2026-08-09T00:00:00Z", local: "2026-08-08T17:00" },
      by: { validAt: "2026-08-09T01:00:00Z", local: "2026-08-08T18:00" },
    });
    const sunday = widened.find((finding) => finding.day === "2026-08-09")!;
    expect(sunday.cadence).toBe("multiHour");
    expect(sunday.verdict).toBe("noInstability");
  });

  it("measures wind persistence as covered span — a lone far-horizon sample is as wide as its step", () => {
    const doc = JSON.parse(JSON.stringify(fixtures["repsErie"])) as { hours: unknown[] };
    doc.hours = [...doc.hours.slice(0, 5), doc.hours[6]];
    const profile = parseSiteForecast(doc)!;
    const findings = ofKind<WindSummaryFinding>(
      analyzeForecast(profile, ERIE).findings,
      "windSummary",
    );
    const sunday = findings.find((finding) => finding.day === "2026-08-09")!;
    expect(sunday.maxWindInBand?.at.validAt).toBe("2026-08-09T15:00:00Z");
    expect(sunday.maxWindInBand?.persistenceHours).toBe(6);
  });
});

describe("smokeImpact", () => {
  const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

  function smokyHrrr(): SiteForecast {
    const doc = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as {
      semantics?: object;
      hours: Array<{ validAt: string; smoke?: object }>;
    };
    doc.semantics = { smoke: "radiativelyCoupled" };
    const blocks: Record<string, { surfaceUgm3: number; columnMgm2: number; aot: number }> = {
      "2026-08-08T19:00:00Z": { surfaceUgm3: 92.4, columnMgm2: 98.6, aot: 0.755 },
      "2026-08-08T21:00:00Z": { surfaceUgm3: 154.24, columnMgm2: 173.1, aot: 0.9174 },
      "2026-08-09T01:00:00Z": { surfaceUgm3: 130.6, columnMgm2: 151.9, aot: 0.622 },
      "2026-08-09T05:00:00Z": { surfaceUgm3: 88.1, columnMgm2: 260.4, aot: 1.383 },
      "2026-08-09T15:00:00Z": { surfaceUgm3: 15.3, columnMgm2: 40.2, aot: 0.213 },
      "2026-08-09T18:00:00Z": { surfaceUgm3: 19.0, columnMgm2: 38.7, aot: 0.201 },
    };
    for (const hour of doc.hours) {
      const block = blocks[hour.validAt];
      if (block) hour.smoke = block;
    }
    const profile = parseSiteForecast(doc);
    expect(profile, "the smoke-carrying construction must satisfy the contract").not.toBeNull();
    return profile!;
  }

  function raqdpsErie(): SmokeDocument {
    const start = Date.parse("2026-08-08T19:00:00Z");
    const rows: Array<[number, number]> = [
      [90.4, 5.2],
      [93.1, 6.0],
      [111.0, 9.8],
      [105.5, 12.1],
      [99.9, 14.0],
      [96.2, 15.3],
      [94.0, 16.8],
      [92.5, 18.5],
      [60.3, 15.0],
      [40.8, 11.2],
      [30.1, 8.4],
      [22.6, 6.1],
      [12.7, 3.9],
    ];
    const parsed = parseSmokeDocument({
      schemaVersion: 1,
      model: "raqdps",
      run: { referenceTime: "2026-08-08T12:00:00Z", generatedAt: "2026-08-08T16:05:00Z" },
      site: {
        id: "erie",
        name: "Erie",
        latitude: 49.43,
        longitude: -117.28,
        timeZone: "America/Vancouver",
      },
      hours: rows.map(([smokePlumeSurfaceUgm3, smokePlumeColumnMgm2], k) => ({
        validAt: iso(start + k * 3_600_000),
        pm25Ugm3: smokePlumeSurfaceUgm3 + 4.5,
        smokePlumeSurfaceUgm3,
        smokePlumeColumnMgm2,
      })),
    });
    expect(parsed, "the smoke-document construction must satisfy the contract").not.toBeNull();
    return parsed!;
  }

  it("republishes the profile's own smoke per day — day peaks AND during-window maxima, both", () => {
    const findings = ofKind<SmokeImpactFinding>(
      analyzeForecast(smokyHrrr(), ERIE).findings,
      "smokeImpact",
    );
    expect(findings.map((finding) => finding.day)).toEqual(["2026-08-08", "2026-08-09"]);
    const saturday = findings[0] as SmokeImpactProfileFinding;
    expect(saturday.source).toBe("profile");
    expect(saturday.semantics).toBe("radiativelyCoupled");
    expect(saturday.peakSurfaceUgm3).toBe(154.2);
    expect(saturday.peakSurfaceAt).toEqual({
      validAt: "2026-08-08T21:00:00Z",
      local: "2026-08-08T14:00",
    });
    expect(saturday.peakAot).toBe(1.383);
    expect(saturday.peakAotAt).toEqual({
      validAt: "2026-08-09T05:00:00Z",
      local: "2026-08-08T22:00",
    });
    expect(saturday.duringWindow).toEqual({ maxSurfaceUgm3: 154.2, maxAot: 0.917 });
    expect(saturday.evidence.hours).toEqual([
      "2026-08-08T19:00:00Z",
      "2026-08-08T21:00:00Z",
      "2026-08-09T01:00:00Z",
      "2026-08-09T05:00:00Z",
    ]);
    expect(saturday.evidence.surfaceUgm3).toEqual([92.4, 154.2, 130.6, 88.1]);
    expect(saturday.evidence.aot).toEqual([0.755, 0.917, 0.622, 1.383]);
    expect("peakColumnMgm2" in saturday).toBe(false);
    expect("smokeRun" in saturday).toBe(false);
    expect("coverage" in saturday).toBe(false);

    const sunday = findings[1] as SmokeImpactProfileFinding;
    expect(sunday.peakSurfaceUgm3).toBe(19);
    expect(sunday.peakAot).toBe(0.213);
    expect(sunday.peakAotAt.validAt).toBe("2026-08-09T15:00:00Z");
    expect(sunday.duringWindow).toEqual({ maxSurfaceUgm3: 19, maxAot: 0.201 });
  });

  it("joins a smoke document onto a smoke-blind profile and confesses the horizon", () => {
    const findings = ofKind<SmokeImpactFinding>(
      analyzeForecast(hrrr(), { ...ERIE, smoke: raqdpsErie() }).findings,
      "smokeImpact",
    );
    expect(findings.map((finding) => finding.day)).toEqual(["2026-08-08", "2026-08-09"]);
    const saturday = findings[0] as SmokeImpactJoinedFinding;
    expect(saturday.source).toBe("joined");
    expect(saturday.semantics).toBe("passive");
    expect(saturday.smokeRun).toEqual({
      model: "raqdps",
      referenceTime: "2026-08-08T12:00:00Z",
    });
    expect(saturday.coverage).toEqual({ joinedHours: 12, profileHours: 12 });
    expect(saturday.peakSurfaceUgm3).toBe(111);
    expect(saturday.peakSurfaceAt.validAt).toBe("2026-08-08T21:00:00Z");
    expect(saturday.peakColumnMgm2).toBe(18.5);
    expect(saturday.peakColumnAt).toEqual({
      validAt: "2026-08-09T02:00:00Z",
      local: "2026-08-08T19:00",
    });
    expect(saturday.duringWindow).toEqual({ maxSurfaceUgm3: 111, maxColumnMgm2: 16.8 });
    expect(saturday.evidence.hours).toHaveLength(12);
    expect(saturday.evidence.surfaceUgm3[2]).toBe(111);
    expect(saturday.evidence.columnMgm2[7]).toBe(18.5);
    expect("peakAot" in saturday).toBe(false);
    expect("aot" in saturday.evidence).toBe(false);
    expect(JSON.stringify(saturday)).not.toMatch(/aot/i);

    const sunday = findings[1] as SmokeImpactJoinedFinding;
    expect(sunday.coverage).toEqual({ joinedHours: 1, profileHours: 12 });
    expect(sunday.peakSurfaceUgm3).toBe(12.7);
    expect(sunday.peakColumnMgm2).toBe(3.9);
    expect(sunday.evidence.hours).toEqual(["2026-08-09T07:00:00Z"]);
    expect(sunday.duringWindow).toBeNull();
  });

  it("says nothing without smoke — no blocks, no document, no finding", () => {
    expect(ofKind(analyzeForecast(hrrr(), ERIE).findings, "smokeImpact")).toHaveLength(0);
  });

  it("prefers the profile's own smoke over a joined document — one sky, stated once", () => {
    const findings = ofKind<SmokeImpactFinding>(
      analyzeForecast(smokyHrrr(), { ...ERIE, smoke: raqdpsErie() }).findings,
      "smokeImpact",
    );
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.source).toBe("profile");
    }
  });

  it("echoes the semantics tag, and reads an untagged smoke block as passive", () => {
    const untagged = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as {
      semantics?: object;
      hours: Array<{ validAt: string; smoke?: object }>;
    };
    untagged.hours[0].smoke = { surfaceUgm3: 45.7, columnMgm2: 61.3, aot: 0.412 };
    const profile = parseSiteForecast(untagged)!;
    const finding = ofKind<SmokeImpactFinding>(
      analyzeForecast(profile, ERIE).findings,
      "smokeImpact",
    )[0];
    expect(finding.source).toBe("profile");
    expect(finding.semantics).toBe("passive");
  });
});

describe("percentileCrossing", () => {
  const crossings = () =>
    ofKind<PercentileCrossingFinding>(
      analyzeForecast(crossingFixture(), ERIE).findings,
      "percentileCrossing",
    );

  it("states the upside day the median suppresses — p50 quiet, p75/p90 clear, minimal token p75", () => {
    const upside = crossings().find((finding) => finding.day === "2026-08-10")!;
    expect(upside.minimalPassingPercentile).toBe("p75");
    expect(upside.perPercentile.p10).toEqual({
      passingSteps: 0,
      hours: [],
      membersMin: null,
      ceiledMembersMax: null,
    });
    expect(upside.perPercentile.p50.passingSteps).toBe(0);
    expect(upside.perPercentile.p75).toEqual({
      passingSteps: 1,
      hours: ["2026-08-10T18:00:00Z"],
      membersMin: 18,
      ceiledMembersMax: 0,
    });
    expect(upside.perPercentile.p90).toEqual({
      passingSteps: 2,
      hours: ["2026-08-10T18:00:00Z", "2026-08-11T00:00:00Z"],
      membersMin: 18,
      ceiledMembersMax: 1,
    });
    expect(upside.thresholds).toEqual({ wstarMinMps: 0.9, depthMinM: 300 });
  });

  it("states the robust mirror on the same shape — p50 passes, p10 fails, minimal token p25", () => {
    const fragile = crossings().find((finding) => finding.day === "2026-08-09")!;
    expect(fragile.minimalPassingPercentile).toBe("p25");
    expect(fragile.perPercentile.p10.passingSteps).toBe(0);
    for (const q of ["p25", "p50", "p75", "p90"] as const) {
      expect(fragile.perPercentile[q].passingSteps).toBe(1);
      expect(fragile.perPercentile[q].hours).toEqual(["2026-08-09T21:00:00Z"]);
      expect(fragile.perPercentile[q].membersMin).toBe(21);
    }
    const windows = ofKind<ThermalWindowFinding>(
      analyzeForecast(crossingFixture(), ERIE).findings,
      "thermalWindow",
    );
    expect(windows.some((finding) => finding.day === "2026-08-09")).toBe(true);
  });

  it("emits nothing for a day where every percentile agrees with the median", () => {
    expect(
      crossings()
        .map((finding) => finding.day)
        .sort(),
    ).toEqual(["2026-08-09", "2026-08-10"]);
  });

  it("anchors leadHours on the minimal percentile's peak-lift hour and confesses cited spacing per-gap", () => {
    const byDay = Object.fromEntries(crossings().map((finding) => [finding.day, finding]));
    expect(byDay["2026-08-09"].leadHours).toBe(27);
    expect(byDay["2026-08-09"].stepHours).toBe(3);
    expect(byDay["2026-08-10"].leadHours).toBe(48);
    expect(byDay["2026-08-10"].stepHours).toBe(6);
  });

  it("moves with the caller's thermalWindow floors — one test, one threshold home", () => {
    const strict = ofKind<PercentileCrossingFinding>(
      analyzeForecast(crossingFixture(), {
        ...ERIE,
        thresholds: { thermalWindow: { depthMinM: 700 } },
      }).findings,
      "percentileCrossing",
    );
    const fragile = strict.find((finding) => finding.day === "2026-08-09")!;
    expect(fragile.minimalPassingPercentile).toBe("p75");
    expect(fragile.perPercentile.p50.passingSteps).toBe(0);
    expect(fragile.thresholds).toEqual({ wstarMinMps: 0.9, depthMinM: 700 });
  });

  it("stays silent on deterministic documents and on real ensembles without a crossing day", () => {
    expect(ofKind(analyzeForecast(hrrr(), ERIE).findings, "percentileCrossing")).toHaveLength(0);
    expect(ofKind(analyzeForecast(reps(), ERIE).findings, "percentileCrossing")).toHaveLength(0);
    expect(ofKind(analyzeForecast(geps(), FLAGPOLE).findings, "percentileCrossing")).toHaveLength(
      0,
    );
  });
});

describe("windSummary.duringWindow", () => {
  it("scopes gust and band wind to the window's hours and keeps the whole-day numbers", () => {
    const saturday = ofKind<WindSummaryFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "windSummary",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.maxGust?.gustMps).toBe(3.9);
    expect(saturday.duringWindow?.windowHours).toHaveLength(7);
    expect(saturday.duringWindow?.windowHours[0]).toBe("2026-08-08T19:00:00Z");
    expect(saturday.duringWindow?.windowHours[6]).toBe("2026-08-09T01:00:00Z");
    expect(saturday.duringWindow?.maxGust).toEqual({
      gustMps: 3.9,
      meanWindMps: 2.72,
      at: { validAt: "2026-08-08T23:00:00Z", local: "2026-08-08T16:00" },
    });
    expect(saturday.duringWindow?.maxWindInBand).toEqual({
      windMps: 4.28,
      directionDeg: 289,
      heightM: 2581.5,
      at: { validAt: "2026-08-08T23:00:00Z", local: "2026-08-08T16:00" },
    });
    expect(saturday.duringWindow?.evidence.hours).toEqual(saturday.duringWindow?.windowHours);
    expect(saturday.duringWindow?.evidence.windGustMps).toEqual([
      2.33, 2.15, 2.59, 3.23, 3.9, 3.74, 3.46,
    ]);
    expect(saturday.duringWindow?.evidence.bandMaxWindMps).toEqual([
      1.87, 2.06, 3.19, 3.65, 4.28, 3.77, 3.49,
    ]);
  });

  it("pins the 02:00 divergence — the whole-day gust cites an hour nobody is airborne", () => {
    const gusty = hrrr();
    for (const hour of gusty.hours) {
      if (hour.validAt === "2026-08-09T09:00:00Z") {
        (hour.surface as { windGustMps: number }).windGustMps = 7.23;
      }
    }
    const sunday = ofKind<WindSummaryFinding>(
      analyzeForecast(gusty, ERIE).findings,
      "windSummary",
    ).find((finding) => finding.day === "2026-08-09")!;
    expect(sunday.maxGust?.gustMps).toBe(7.23);
    expect(sunday.maxGust?.at.local).toBe("2026-08-09T02:00");
    expect(sunday.duringWindow?.windowHours).toEqual(["2026-08-09T18:00:00Z"]);
    expect(sunday.duringWindow?.maxGust?.gustMps).toBe(3.05);
    expect(sunday.duringWindow?.maxGust?.at.local).toBe("2026-08-09T11:00");
    expect(sunday.duringWindow?.evidence.windGustMps).toEqual([3.05]);
    expect(sunday.duringWindow?.evidence.bandMaxWindMps).toEqual([1.51]);
  });

  it("is absent on quiet days — the scope is the thermalWindow, and there is none", () => {
    const analysis = analyzeForecast(hrrr(), {
      ...ERIE,
      thresholds: { thermalWindow: { wstarMinMps: 99 } },
    });
    expect(ofKind(analysis.findings, "thermalWindow")).toHaveLength(0);
    const findings = ofKind<WindSummaryFinding>(analysis.findings, "windSummary");
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.maxGust).toBeDefined();
      expect(finding.duringWindow).toBeUndefined();
    }
  });

  it("carries the gust semantics echo, and gustless models read null gust evidence", () => {
    const saturday = ofKind<WindSummaryFinding>(
      analyzeForecast(reps(), ERIE).findings,
      "windSummary",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.duringWindow?.windowHours).toEqual(["2026-08-08T21:00:00Z"]);
    expect(saturday.duringWindow?.maxGust).toBeUndefined();
    expect(saturday.duringWindow?.evidence.windGustMps).toEqual([null]);
    expect(saturday.duringWindow?.evidence.bandMaxWindMps).toEqual([1.78]);
    expect(saturday.maxWindInBand?.windMps).toBe(2.01);
    expect(saturday.duringWindow?.maxWindInBand?.windMps).toBe(1.78);

    const tagged = hrrr();
    (tagged as { semantics?: object }).semantics = {
      gust: "instant",
      precipitation: "instantRate",
    };
    const summary = ofKind<WindSummaryFinding>(
      analyzeForecast(parseSiteForecast(tagged)!, ERIE).findings,
      "windSummary",
    )[0];
    expect(summary.duringWindow?.maxGust?.semantics).toBe("instant");
  });

  it("states pressureHpa as null under full ensemble dropout — no more NaN under a number type", () => {
    const doc = JSON.parse(JSON.stringify(fixtures["repsErie"])) as {
      hours: Array<{ levels: Array<{ pressureHpa: unknown }> }>;
    };
    doc.hours[6].levels[0].pressureHpa = {
      members: 0,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
    };
    const sunday = ofKind<WindSummaryFinding>(
      analyzeForecast(parseSiteForecast(doc)!, ERIE).findings,
      "windSummary",
    ).find((finding) => finding.day === "2026-08-09")!;
    expect(sunday.maxWindInBand?.windMps).toBe(1.58);
    expect(sunday.maxWindInBand?.pressureHpa).toBeNull();
    expect(Number.isNaN(sunday.maxWindInBand?.pressureHpa)).toBe(false);
  });
});

describe("windExceedance", () => {
  const tagged = () => {
    const doc = hrrr();
    (doc as { semantics?: object }).semantics = {
      gust: "hourMax",
      precipitation: "instantRate",
    };
    return parseSiteForecast(doc)!;
  };

  it("emits nothing without caller ceilings — no defaults exist anywhere", () => {
    const findings = ofKind(analyzeForecast(tagged(), ERIE).findings, "windExceedance");
    expect(findings).toHaveLength(0);
    expect(
      ofKind(analyzeForecast(tagged(), { ...ERIE, windCeilings: {} }).findings, "windExceedance"),
    ).toHaveLength(0);
  });

  it("finds maximal runs per day and quantity over window hours, threshold echoed verbatim", () => {
    const findings = ofKind<WindExceedanceFinding>(
      analyzeForecast(tagged(), {
        ...ERIE,
        windCeilings: { surfaceMps: 2.5, gust: { hourMaxMps: 3 }, bandMps: 4 },
      }).findings,
      "windExceedance",
    );
    expect(findings.map((finding) => [finding.day, finding.quantity]).sort()).toEqual([
      ["2026-08-08", "bandWind"],
      ["2026-08-08", "gust"],
      ["2026-08-08", "surfaceWind"],
      ["2026-08-09", "gust"],
    ]);

    const gust = findings.find(
      (finding) => finding.day === "2026-08-08" && finding.quantity === "gust",
    )!;
    expect(gust.thresholdMps).toBe(3);
    expect(gust.gustSemantics).toBe("hourMax");
    expect(gust.stepHours).toBe(1);
    expect(gust.runs).toEqual([
      {
        start: { validAt: "2026-08-08T22:00:00Z", local: "2026-08-08T15:00" },
        end: { validAt: "2026-08-09T01:00:00Z", local: "2026-08-08T18:00" },
        hours: 4,
        peakMps: 3.9,
        peakAt: { validAt: "2026-08-08T23:00:00Z", local: "2026-08-08T16:00" },
      },
    ]);
    expect(gust.evidence.hours).toHaveLength(7);
    expect(gust.evidence.valueMps).toEqual([2.33, 2.15, 2.59, 3.23, 3.9, 3.74, 3.46]);

    const surface = findings.find(
      (finding) => finding.day === "2026-08-08" && finding.quantity === "surfaceWind",
    )!;
    expect(surface.gustSemantics).toBeUndefined();
    expect(surface.runs).toEqual([
      {
        start: { validAt: "2026-08-08T22:00:00Z", local: "2026-08-08T15:00" },
        end: { validAt: "2026-08-08T23:00:00Z", local: "2026-08-08T16:00" },
        hours: 2,
        peakMps: 2.72,
        peakAt: { validAt: "2026-08-08T23:00:00Z", local: "2026-08-08T16:00" },
      },
    ]);

    const band = findings.find(
      (finding) => finding.day === "2026-08-08" && finding.quantity === "bandWind",
    )!;
    expect(band.runs).toHaveLength(1);
    expect(band.runs[0].hours).toBe(1);
    expect(band.runs[0].peakMps).toBe(4.28);

    const sundayGust = findings.find(
      (finding) => finding.day === "2026-08-09" && finding.quantity === "gust",
    )!;
    expect(sundayGust.runs).toEqual([
      {
        start: { validAt: "2026-08-09T18:00:00Z", local: "2026-08-09T11:00" },
        end: { validAt: "2026-08-09T18:00:00Z", local: "2026-08-09T11:00" },
        hours: 1,
        peakMps: 3.05,
        peakAt: { validAt: "2026-08-09T18:00:00Z", local: "2026-08-09T11:00" },
      },
    ]);
  });

  it("refuses across gust semantics classes — an instant ceiling reads nothing from an hourMax document", () => {
    const wrongClass = analyzeForecast(tagged(), {
      ...ERIE,
      windCeilings: { gust: { instantMps: 3 } },
    });
    expect(ofKind(wrongClass.findings, "windExceedance")).toHaveLength(0);
    const untagged = analyzeForecast(hrrr(), {
      ...ERIE,
      windCeilings: { gust: { hourMaxMps: 3, instantMps: 3 } },
    });
    expect(ofKind(untagged.findings, "windExceedance")).toHaveLength(0);
  });

  it("breaks runs at scope gaps — two same-day windows never bridge into one run", () => {
    const dipped = tagged();
    for (const hour of dipped.hours) {
      if (hour.validAt === "2026-08-08T22:00:00Z") {
        (hour.derived as { thermalVelocityMps: number }).thermalVelocityMps = 0.85;
      }
    }
    const saturday = ofKind<WindExceedanceFinding>(
      analyzeForecast(dipped, { ...ERIE, windCeilings: { gust: { hourMaxMps: 2 } } }).findings,
      "windExceedance",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.evidence.hours).toHaveLength(6);
    expect(saturday.runs.map((run) => [run.start.validAt, run.end.validAt, run.hours])).toEqual([
      ["2026-08-08T19:00:00Z", "2026-08-08T21:00:00Z", 3],
      ["2026-08-08T23:00:00Z", "2026-08-09T01:00:00Z", 3],
    ]);
  });

  it("reads ensembles at p50 and confesses coarse cadence in run lengths", () => {
    const findings = ofKind<WindExceedanceFinding>(
      analyzeForecast(reps(), {
        ...ERIE,
        windCeilings: { gust: { hourMaxMps: 1, instantMps: 1 }, bandMps: 1.5 },
      }).findings,
      "windExceedance",
    );
    expect(findings).toHaveLength(1);
    const band = findings[0];
    expect(band.day).toBe("2026-08-08");
    expect(band.quantity).toBe("bandWind");
    expect(band.stepHours).toBe(3);
    expect(band.runs).toEqual([
      {
        start: { validAt: "2026-08-08T21:00:00Z", local: "2026-08-08T14:00" },
        end: { validAt: "2026-08-08T21:00:00Z", local: "2026-08-08T14:00" },
        hours: 3,
        peakMps: 1.78,
        peakAt: { validAt: "2026-08-08T21:00:00Z", local: "2026-08-08T14:00" },
      },
    ]);
  });
});

describe("windDirection", () => {
  const winHours = [
    "2026-08-08T19:00:00Z",
    "2026-08-08T20:00:00Z",
    "2026-08-08T21:00:00Z",
    "2026-08-08T22:00:00Z",
    "2026-08-08T23:00:00Z",
    "2026-08-09T00:00:00Z",
    "2026-08-09T01:00:00Z",
  ];

  function rotating(): SiteForecast {
    const doc = hrrr();
    const dirs = [115, 126, 141, 165, 195, 216, 242];
    for (const hour of doc.hours) {
      const index = winHours.indexOf(hour.validAt);
      if (index === -1) continue;
      (hour.surface as { windSpeedMps: number; windDirectionDeg: number }).windSpeedMps = 2;
      (hour.surface as { windSpeedMps: number; windDirectionDeg: number }).windDirectionDeg =
        dirs[index];
    }
    return doc;
  }

  it("states the rotation: start, peak-lift, end samples and the net circular veer", () => {
    const saturday = ofKind<WindDirectionFinding>(
      analyzeForecast(rotating(), ERIE).findings,
      "windDirection",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.window.start.validAt).toBe("2026-08-08T19:00:00Z");
    expect(saturday.window.end.validAt).toBe("2026-08-09T01:00:00Z");
    expect(saturday.surface.start).toEqual({ directionDeg: 115, speedMps: 2 });
    expect(saturday.surface.peakLift).toEqual({
      directionDeg: 195,
      speedMps: 2,
      at: { validAt: "2026-08-08T23:00:00Z", local: "2026-08-08T16:00" },
    });
    expect(saturday.surface.end).toEqual({ directionDeg: 242, speedMps: 2 });
    expect(saturday.netVeerDeg).toBe(127);
    expect(saturday.surfaceVectorMean).toEqual({ directionDeg: 170, speedMps: 1.45 });
    expect(saturday.thresholds).toEqual({ directionFloorMps: 1 });
    expect(saturday.evidence.hours).toEqual(winHours);
    expect(saturday.evidence.surfaceDirectionDeg).toEqual([115, 126, 141, 165, 195, 216, 242]);
    expect(saturday.evidence.surfaceSpeedMps).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it("reads the real document: gentle veer, vector means, and the band mean over 24 level samples", () => {
    const findings = ofKind<WindDirectionFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "windDirection",
    );
    expect(findings.map((finding) => finding.day)).toEqual(["2026-08-08", "2026-08-09"]);
    const saturday = findings[0];
    expect(saturday.surface.start).toEqual({ directionDeg: 228, speedMps: 1.92 });
    expect(saturday.surface.end).toEqual({ directionDeg: 232, speedMps: 2.32 });
    expect(saturday.netVeerDeg).toBe(4);
    expect(saturday.surfaceVectorMean).toEqual({ directionDeg: 238, speedMps: 2.21 });
    expect(saturday.bandVectorMean).toEqual({ directionDeg: 262, speedMps: 2.31, samples: 24 });

    const sunday = findings[1];
    expect(sunday.surface.start).toEqual({ directionDeg: 220, speedMps: 1.02 });
    expect(sunday.netVeerDeg).toBe(0);
    expect(sunday.bandVectorMean).toEqual({ directionDeg: 252, speedMps: 1.25, samples: 2 });
  });

  it("suppresses direction under the floor — calm has no bearing, and the floor is the caller's", () => {
    const drifting = rotating();
    for (const hour of drifting.hours) {
      if (hour.validAt === "2026-08-08T19:00:00Z") {
        (hour.surface as { windSpeedMps: number }).windSpeedMps = 0.4;
      }
    }
    const saturday = ofKind<WindDirectionFinding>(
      analyzeForecast(drifting, ERIE).findings,
      "windDirection",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.surface.start).toEqual({ directionDeg: null, speedMps: 0.4 });
    expect(saturday.netVeerDeg).toBeNull();
    const lowered = ofKind<WindDirectionFinding>(
      analyzeForecast(drifting, {
        ...ERIE,
        thresholds: { windDirection: { directionFloorMps: 0.3 } },
      }).findings,
      "windDirection",
    ).find((finding) => finding.day === "2026-08-08")!;
    expect(lowered.surface.start).toEqual({ directionDeg: 115, speedMps: 0.4 });
    expect(lowered.netVeerDeg).toBe(127);
    expect(lowered.thresholds).toEqual({ directionFloorMps: 0.3 });
  });

  it("gates itself off ensembles — direction percentiles are not circular statistics", () => {
    const analysis = analyzeForecast(reps(), ERIE);
    expect(ofKind(analysis.findings, "thermalWindow").length).toBeGreaterThan(0);
    expect(ofKind(analysis.findings, "windDirection")).toHaveLength(0);
    expect(ofKind(analyzeForecast(geps(), FLAGPOLE).findings, "windDirection")).toHaveLength(0);
  });
});

describe("bandShear", () => {
  it("finds the day's strongest layer with mandatory bounds and endpoint winds", () => {
    const findings = ofKind<BandShearFinding>(analyzeForecast(hrrr(), ERIE).findings, "bandShear");
    const saturday = findings.find((finding) => finding.day === "2026-08-08")!;
    expect(saturday.maxShear.ratePerKm).toBe(3.11);
    expect(saturday.maxShear.shearMps).toBe(1.6);
    expect(saturday.maxShear.layer).toEqual({ fromM: 1525.6, toM: 2040.5, thicknessM: 514.9 });
    expect(saturday.maxShear.at).toEqual({
      validAt: "2026-08-08T20:00:00Z",
      local: "2026-08-08T13:00",
    });
    expect(saturday.maxShear.lower).toEqual({ speedMps: 1.39, directionDeg: 214, heightM: 1525.6 });
    expect(saturday.maxShear.upper).toEqual({ speedMps: 2.06, directionDeg: 265, heightM: 2040.5 });
    expect(saturday.levelsInBand).toBe(3);
    expect(saturday.bothEndpointsUnderFloorMps).toBe(false);
    expect(saturday.thresholds).toEqual({ minLayerThicknessM: 30, endpointFloorMps: 2 });
    expect(saturday.evidence.hours).toHaveLength(7);
    expect(saturday.evidence.maxRatePerKm).toEqual([1.19, 3.11, 2.48, 2.18, 2.21, 1.95, 1.97]);
  });

  it("flags a layer whose endpoints are both light wind — an arithmetic relation, no verdict", () => {
    const sunday = ofKind<BandShearFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "bandShear",
    ).find((finding) => finding.day === "2026-08-09")!;
    expect(sunday.maxShear.ratePerKm).toBe(2.27);
    expect(sunday.maxShear.layer).toEqual({ fromM: 1258.4, toM: 1506.4, thicknessM: 248 });
    expect(sunday.levelsInBand).toBe(2);
    expect(sunday.bothEndpointsUnderFloorMps).toBe(true);
    expect(JSON.stringify(sunday)).not.toMatch(/hazard|quality|suspect/i);
  });

  it("is absent when the column offers fewer than two in-band levels — too sparse to state", () => {
    const sparse = hrrr();
    for (const hour of sparse.hours) {
      (hour as { levels: unknown[] }).levels = hour.levels.slice(0, 1);
    }
    expect(ofKind(analyzeForecast(sparse, ERIE).findings, "bandShear")).toHaveLength(0);
    expect(
      ofKind(
        analyzeForecast(hrrr(), {
          ...ERIE,
          thresholds: { bandShear: { minLayerThicknessM: 600 } },
        }).findings,
        "bandShear",
      ),
    ).toHaveLength(0);
  });

  it("gates itself off ensembles — level direction percentiles are no more circular than surface ones", () => {
    const analysis = analyzeForecast(reps(), ERIE);
    expect(ofKind(analysis.findings, "thermalWindow").length).toBeGreaterThan(0);
    expect(ofKind(analysis.findings, "bandShear")).toHaveLength(0);
    expect(ofKind(analyzeForecast(geps(), FLAGPOLE).findings, "bandShear")).toHaveLength(0);
  });
});

describe("dataCaveats", () => {
  it("declares what REPS cannot say — the whole science wave absent, threshold-free", () => {
    const finding = ofKind<DataCaveatsFinding>(
      analyzeForecast(reps(), ERIE).findings,
      "dataCaveats",
    )[0];
    const absent = finding.caveats.find((caveat) => caveat.caveat === "absentQuantities")!;
    expect(absent.quantities).toEqual(
      expect.arrayContaining(["windGustMps", "capeJkg", "cinJkg", "pblHeightM"]),
    );
    expect(finding.caveats).toContainEqual({
      caveat: "derivedNullHours",
      quantity: "usableLiftTopM",
      hoursNull: 4,
      ofHours: 8,
    });
    expect(finding.caveats).toContainEqual({ caveat: "stepCadence", stepHours: 3 });
    expect(JSON.stringify(finding)).not.toMatch(/threshold/i);
  });

  it("names the smoke family absent on a smoke-blind analysis — absence is never clear air", () => {
    const analysis = analyzeForecast(hrrr(), ERIE);
    expect(ofKind(analysis.findings, "smokeImpact")).toHaveLength(0);
    const absent = ofKind<DataCaveatsFinding>(analysis.findings, "dataCaveats")[0].caveats.find(
      (caveat) => caveat.caveat === "absentQuantities",
    )!;
    expect(absent.quantities).toContain("smoke");
  });

  it("drops the smoke caveat exactly when the analysis states smoke", () => {
    const smoky = hrrr();
    smoky.hours[0].smoke = { surfaceUgm3: 45.7, columnMgm2: 61.3, aot: 0.412 };
    const own = ofKind<DataCaveatsFinding>(
      analyzeForecast(smoky, ERIE).findings,
      "dataCaveats",
    )[0].caveats.find((caveat) => caveat.caveat === "absentQuantities");
    expect(own?.quantities ?? []).not.toContain("smoke");
    const smoke = parseSmokeDocument({
      schemaVersion: 1,
      model: "raqdps",
      run: { referenceTime: "2026-08-08T12:00:00Z", generatedAt: "2026-08-08T16:05:00Z" },
      site: { id: "erie", name: "Erie", latitude: 49.43, longitude: -117.28 },
      hours: [
        {
          validAt: "2026-08-08T19:00:00Z",
          pm25Ugm3: 94.9,
          smokePlumeSurfaceUgm3: 90.4,
          smokePlumeColumnMgm2: 5.2,
        },
      ],
    })!;
    const joined = analyzeForecast(hrrr(), { ...ERIE, smoke });
    expect(ofKind(joined.findings, "smokeImpact")).toHaveLength(1);
    const viaJoin = ofKind<DataCaveatsFinding>(joined.findings, "dataCaveats")[0].caveats.find(
      (caveat) => caveat.caveat === "absentQuantities",
    );
    expect(viaJoin?.quantities ?? []).not.toContain("smoke");
  });

  it("keeps the smoke caveat when a supplied document never matches — smoke-blind is a join OUTCOME", () => {
    const smoke = parseSmokeDocument({
      schemaVersion: 1,
      model: "raqdps",
      run: { referenceTime: "2026-08-12T12:00:00Z", generatedAt: "2026-08-12T16:05:00Z" },
      site: { id: "erie", name: "Erie", latitude: 49.43, longitude: -117.28 },
      hours: [
        {
          validAt: "2026-08-12T19:00:00Z",
          pm25Ugm3: 94.9,
          smokePlumeSurfaceUgm3: 90.4,
          smokePlumeColumnMgm2: 5.2,
        },
      ],
    })!;
    const analysis = analyzeForecast(hrrr(), { ...ERIE, smoke });
    expect(ofKind(analysis.findings, "smokeImpact")).toHaveLength(0);
    const absent = ofKind<DataCaveatsFinding>(analysis.findings, "dataCaveats")[0].caveats.find(
      (caveat) => caveat.caveat === "absentQuantities",
    )!;
    expect(absent.quantities).toContain("smoke");
  });

  it("does not call a science-capable document's fields absent", () => {
    const finding = ofKind<DataCaveatsFinding>(
      analyzeForecast(hrrr(), ERIE).findings,
      "dataCaveats",
    )[0];
    const absent = finding.caveats.find((caveat) => caveat.caveat === "absentQuantities");
    expect(absent?.quantities ?? []).not.toContain("capeJkg");
    expect(absent?.quantities ?? []).not.toContain("windGustMps");
    expect(finding.caveats.some((caveat) => caveat.caveat === "stepCadence")).toBe(false);
  });
});

describe("tolerant-reader versioning (Tier 2 §3)", () => {
  it("types vocabularyVersion as number — cached envelopes survive upgrades as data", () => {
    const analysis = analyzeForecast(hrrr(), ERIE);
    const version: number = analysis.vocabularyVersion;
    expect(version).toBe(ANALYZE_VOCABULARY_VERSION);
  });

  it("a compiled consumer with a default arm is conforming — unknown kinds are ignorable", () => {
    const analysis = analyzeForecast(hrrr(), ERIE);
    let known = 0;
    let ignored = 0;
    for (const finding of analysis.findings) {
      switch (finding.kind) {
        case "thermalWindow":
        case "quietDay":
        case "dataCaveats":
          known += 1;
          break;
        default:
          ignored += 1;
          break;
      }
    }
    expect(known).toBeGreaterThan(0);
    expect(known + ignored).toBe(analysis.findings.length);
  });
});

describe("the extension door (the public frame)", () => {
  const frameProbe: AnalysisExtension = {
    name: "test/frameProbe",
    extract: (frame, findings) => [
      {
        frameVersion: ANALYSIS_FRAME_VERSION,
        deterministic: frame.deterministic,
        stepHours: frame.stepHours,
        maxStepHours: frame.steps.maxStepHours,
        launchElevationM: frame.launchElevationM,
        launchReferenceM: frame.launchReferenceM,
        firstHour: frame.cite(frame.profile.hours[0].validAt),
        firstDay: frame.dayOf(frame.profile.hours[0].validAt),
        firstLeadHours: frame.leadHours(frame.profile.hours[0].validAt),
        windowCount: findings.filter((finding) => finding.kind === "thermalWindow").length,
      },
    ],
  };

  it("hands the extension the resolved per-analysis facts, bound to the zone and run", () => {
    const analysis = analyzeForecast(hrrr(), { ...ERIE, extensions: [frameProbe] });
    expect(analysis.extensions).toHaveLength(1);
    expect(analysis.extensions![0].extension).toBe("test/frameProbe");
    const windowCount = ofKind<ThermalWindowFinding>(analysis.findings, "thermalWindow").length;
    expect(analysis.extensions![0].statements).toEqual([
      {
        frameVersion: 1,
        deterministic: true,
        stepHours: 1,
        maxStepHours: 1,
        launchElevationM: 1247,
        launchReferenceM: 1247,
        firstHour: { validAt: "2026-08-08T19:00:00Z", local: "2026-08-08T12:00" },
        firstDay: "2026-08-08",
        firstLeadHours: 1,
        windowCount,
      },
    ]);
  });

  it("keeps extension statements OUT of findings, and findings untouched", () => {
    const plain = analyzeForecast(hrrr(), ERIE);
    const extended = analyzeForecast(hrrr(), { ...ERIE, extensions: [frameProbe] });
    expect(extended.findings).toEqual(plain.findings);
    expect("extensions" in plain).toBe(false);
  });

  it("delivers entries named and in caller order — two extensions never blur", () => {
    const constant = (name: string, value: string): AnalysisExtension => ({
      name,
      extract: () => [value],
    });
    const analysis = analyzeForecast(hrrr(), {
      ...ERIE,
      extensions: [constant("a/one", "first"), constant("b/two", "second")],
    });
    expect(analysis.extensions).toEqual([
      { extension: "a/one", statements: ["first"] },
      { extension: "b/two", statements: ["second"] },
    ]);
  });

  it("refuses duplicate extension names in one call", () => {
    const noop: AnalysisExtension = { name: "dup", extract: () => [] };
    expect(() => analyzeForecast(hrrr(), { ...ERIE, extensions: [noop, { ...noop }] })).toThrow(
      /duplicate extension name \(dup\)/,
    );
  });

  it("lets a throwing extension fail the analysis — caller code is not sandboxed", () => {
    const broken: AnalysisExtension = {
      name: "broken",
      extract: () => {
        throw new Error("extension bug");
      },
    };
    expect(() => analyzeForecast(hrrr(), { ...ERIE, extensions: [broken] })).toThrow(
      /extension bug/,
    );
  });

  it("receives the FINISHED findings and the honest ensemble facts", () => {
    const analysis = analyzeForecast(geps(), { ...FLAGPOLE, extensions: [frameProbe] });
    const statement = analysis.extensions![0].statements[0] as {
      windowCount: number;
      deterministic: boolean;
      stepHours: number;
    };
    expect(statement.windowCount).toBe(
      ofKind<ThermalWindowFinding>(analysis.findings, "thermalWindow").length,
    );
    expect(statement.deterministic).toBe(false);
    expect(statement.stepHours).toBe(3);
  });
});
