import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSiteForecast, type SiteForecast } from "../src/contract.js";
import {
  compareAnalyses,
  compareForecasts,
  comparisonMemberKey,
  COMPARE_VOCABULARY_VERSION,
  type HeightSpreadFinding,
  type WindDirectionSpreadFinding,
  type WindDivergenceFinding,
  type WindowAgreementFinding,
} from "../src/compare.js";
import {
  analyzeForecast,
  DEFAULT_ANALYZE_THRESHOLDS,
  type AnalyzeOptions,
  type ForecastAnalysis,
} from "../src/analyze/index.js";

const fixtures = JSON.parse(
  readFileSync(join(__dirname, "analyze-fixtures.json"), "utf-8"),
) as Record<string, unknown>;

function load(key: string): SiteForecast {
  const profile = parseSiteForecast(fixtures[key]);
  expect(profile).not.toBeNull();
  return profile!;
}

const TZ = "America/Vancouver";
const hrrr = () => load("hrrrConusErie");
const reps = () => load("repsErie");

const ERIE_LAUNCH = { elevationM: 1247 };

function ofKind<T extends { kind: string }>(
  findings: readonly { kind: string }[],
  kind: T["kind"],
): T[] {
  return findings.filter((finding) => finding.kind === kind) as T[];
}

function utcAt(day: string, localHour: number): string {
  return new Date(Date.parse(`${day}T07:00:00Z`) + localHour * 3_600_000)
    .toISOString()
    .replace(".000Z", "Z");
}

interface HourSpec {
  validAt: string;
  wstar: number;
  top: number | null;
  wind?: { speedMps: number; directionDeg: number };
  gustMps?: number;
  levels?: Array<{
    heightM: number;
    windSpeedMps: number;
    windDirectionDeg: number;
    pressureHpa: number;
  }>;
}

function detMember(opts: {
  model: string;
  referenceTime: string;
  modelElevationM?: number;
  gustSemantics?: "hourMax" | "instant";
  hours: HourSpec[];
}): SiteForecast {
  const doc = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as {
    model: string;
    run: { referenceTime: string };
    site: { modelElevationM: number };
    semantics?: { gust: "hourMax" | "instant" };
    hours: Array<{
      validAt: string;
      surface: Record<string, unknown>;
      derived: Record<string, unknown>;
      levels: Array<Record<string, unknown>>;
    }>;
  };
  doc.model = opts.model;
  doc.run.referenceTime = opts.referenceTime;
  if (opts.modelElevationM !== undefined) doc.site.modelElevationM = opts.modelElevationM;
  if (opts.gustSemantics) doc.semantics = { gust: opts.gustSemantics };
  const template = JSON.stringify(doc.hours[0]);
  doc.hours = opts.hours.map((spec) => {
    const hour = JSON.parse(template) as (typeof doc.hours)[number];
    hour.validAt = spec.validAt;
    hour.derived.thermalVelocityMps = spec.wstar;
    hour.derived.usableLiftTopM = spec.top;
    if (spec.wind) {
      hour.surface.windSpeedMps = spec.wind.speedMps;
      hour.surface.windDirectionDeg = spec.wind.directionDeg;
    }
    if (spec.gustMps !== undefined) hour.surface.windGustMps = spec.gustMps;
    if (spec.levels) {
      const levelTemplate = hour.levels[0];
      hour.levels = spec.levels.map((level) => ({ ...levelTemplate, ...level }));
    }
    return hour;
  });
  const profile = parseSiteForecast(doc);
  expect(profile, `${opts.model} must satisfy the published contract`).not.toBeNull();
  return profile!;
}

function fullDay(day: string, spec: (localHour: number) => Omit<HourSpec, "validAt">): HourSpec[] {
  return Array.from({ length: 24 }, (_, localHour) => ({
    validAt: utcAt(day, localHour),
    ...spec(localHour),
  }));
}

const QUIET = { wstar: 0.1, top: 1300 };

describe("compareForecasts guards", () => {
  it("refuses mixed sites — one comparison, one site", () => {
    expect(() => compareForecasts([hrrr(), load("gepsFlagpole")], { timeZone: TZ })).toThrow(
      /mixed sites/,
    );
  });

  it("refuses an empty member list", () => {
    expect(() => compareForecasts([], { timeZone: TZ })).toThrow(/no members/);
  });

  it("refuses the SAME run twice — identity is (model, referenceTime)", () => {
    expect(() => compareForecasts([hrrr(), hrrr()], { timeZone: TZ })).toThrow(
      /duplicate member \(hrrr-conus@2026-08-08T18:00:00Z\)/,
    );
  });
});

describe("compareAnalyses — the coherence-validated door", () => {
  const analyzed = (profile: SiteForecast, overrides: Partial<AnalyzeOptions> = {}) =>
    analyzeForecast(profile, { timeZone: TZ, launch: ERIE_LAUNCH, ...overrides });

  it("equals the wrapper on the same inputs — one construction, no duplicated logic", () => {
    const unavailable = [{ model: "nam-conus-nest", miss: "absent" as const }];
    const viaProfiles = compareForecasts([hrrr(), reps()], {
      timeZone: TZ,
      launch: ERIE_LAUNCH,
      unavailable,
    });
    const viaAnalyses = compareAnalyses([analyzed(hrrr()), analyzed(reps())], { unavailable });
    expect(viaAnalyses).toEqual(viaProfiles);
  });

  it("accepts serialized envelopes — the cached-analysis door, whole point of the seam", () => {
    const cached = [analyzed(hrrr()), analyzed(reps())].map(
      (analysis) => JSON.parse(JSON.stringify(analysis)) as ForecastAnalysis,
    );
    expect(compareAnalyses(cached)).toEqual(
      compareForecasts([hrrr(), reps()], { timeZone: TZ, launch: ERIE_LAUNCH }),
    );
  });

  it("refuses an empty member list", () => {
    expect(() => compareAnalyses([])).toThrow(/no members/);
  });

  it("refuses mixed sites — one comparison, one site", () => {
    expect(() => compareAnalyses([analyzed(hrrr()), analyzed(load("gepsFlagpole"))])).toThrow(
      /mixed sites \(erie vs flagpole\)/,
    );
  });

  it("refuses the SAME analysis twice — identity is (model, referenceTime)", () => {
    expect(() => compareAnalyses([analyzed(hrrr()), analyzed(hrrr())])).toThrow(
      /duplicate member \(hrrr-conus@2026-08-08T18:00:00Z\)/,
    );
  });

  it("refuses vocabulary version skew, naming the member, both versions, and the remedy", () => {
    const stale: ForecastAnalysis = { ...analyzed(hrrr()), vocabularyVersion: 3 };
    expect(() => compareAnalyses([stale, analyzed(reps())])).toThrow(
      /vocabulary version skew — member hrrr-conus@2026-08-08T18:00:00Z carries vocabularyVersion 3, this package compares vocabulary 5; re-analyze/,
    );
  });

  it("refuses an envelope that does not self-describe — the pre-0.22 case", () => {
    for (const field of ["thresholds", "deterministic", "coveredDays"]) {
      const legacy = { ...analyzed(hrrr()) } as unknown as Record<string, unknown>;
      delete legacy[field];
      expect(() => compareAnalyses([legacy as unknown as ForecastAnalysis])).toThrow(
        new RegExp(`member hrrr-conus@2026-08-08T18:00:00Z lacks ${field} — .*re-analyze`),
      );
    }
  });

  it("refuses mixed timezones — day keys pair only in one zone", () => {
    expect(() =>
      compareAnalyses([analyzed(hrrr()), analyzed(reps(), { timeZone: "America/Edmonton" })]),
    ).toThrow(/mixed timezones \(America\/Vancouver vs America\/Edmonton\)/);
  });

  it("refuses mixed launches, null included — one launch per comparison", () => {
    expect(() => compareAnalyses([analyzed(hrrr()), analyzed(reps(), { launch: null })])).toThrow(
      /mixed launches \(1247 vs null\)/,
    );
    expect(() =>
      compareAnalyses([analyzed(hrrr()), analyzed(reps(), { launch: { elevationM: 1200 } })]),
    ).toThrow(/mixed launches \(1247 vs 1200\)/);
  });

  it("refuses threshold inequality, naming the first differing path with both values", () => {
    expect(() =>
      compareAnalyses([
        analyzed(hrrr()),
        analyzed(reps(), { thresholds: { thermalWindow: { wstarMinMps: 0.8 } } }),
      ]),
    ).toThrow(/threshold mismatch \(thermalWindow\.wstarMinMps: 0\.9 vs 0\.8\)/);
  });
});

describe("member identity (model, referenceTime) — the v2 breaking change", () => {
  const laterDoc = JSON.parse(JSON.stringify(fixtures["hrrrConusErie"])) as {
    run: { referenceTime: string };
  };
  laterDoc.run.referenceTime = "2026-08-09T00:00:00Z";
  const later = parseSiteForecast(laterDoc)!;
  const comparison = compareForecasts([hrrr(), later], { timeZone: TZ, launch: ERIE_LAUNCH });

  it("holds two runs of one model as two members with distinct keys", () => {
    expect(comparison.members).toHaveLength(2);
    const keys = comparison.members.map((member) => member.member);
    expect(keys).toEqual(["hrrr-conus@2026-08-08T18:00:00Z", "hrrr-conus@2026-08-09T00:00:00Z"]);
    expect(comparison.members.every((member) => member.model === "hrrr-conus")).toBe(true);
    expect(keys[0]).toBe(comparisonMemberKey("hrrr-conus", "2026-08-08T18:00:00Z"));
    expect(comparison.newestReferenceTime).toBe("2026-08-09T00:00:00Z");
    expect(comparison.members.map((member) => member.runAgeHours)).toEqual([6, 0]);
  });

  it("keys analyses by the member key — both runs' provenance held at once", () => {
    expect(Object.keys(comparison.analyses).sort()).toEqual([
      "hrrr-conus@2026-08-08T18:00:00Z",
      "hrrr-conus@2026-08-09T00:00:00Z",
    ]);
  });

  it("counts the two runs as two voters", () => {
    const agreement = ofKind<WindowAgreementFinding>(comparison.findings, "windowAgreement");
    const day = agreement.find((finding) => finding.day === "2026-08-08")!;
    expect(day.voters).toBe(2);
    expect(day.unanimous).toBe(true);
    expect(day.windows.map((vote) => vote.member).sort()).toEqual([
      "hrrr-conus@2026-08-08T18:00:00Z",
      "hrrr-conus@2026-08-09T00:00:00Z",
    ]);
    const spread = ofKind<HeightSpreadFinding>(comparison.findings, "heightSpread").find(
      (finding) => finding.day === "2026-08-08",
    )!;
    expect(spread.peaks).toHaveLength(2);
    expect(spread.spreadM).toBe(0);
  });
});

describe("the member ledger", () => {
  const comparison = compareForecasts([hrrr(), reps()], {
    timeZone: TZ,
    launch: ERIE_LAUNCH,
    unavailable: [{ model: "nam-conus-nest", miss: "absent" }],
  });

  it("states comparability facts per member — kind, cadence, run age, elevation delta", () => {
    const byModel = Object.fromEntries(comparison.members.map((member) => [member.model, member]));
    expect(byModel["hrrr-conus"].kind).toBe("deterministic");
    expect(byModel["reps"].kind).toBe("ensemble");
    expect(byModel["hrrr-conus"].stepHours).toBe(1);
    expect(byModel["reps"].stepHours).toBe(3);
    for (const member of comparison.members) {
      expect(member.member).toBe(comparisonMemberKey(member.model, member.referenceTime));
      expect(member.runAgeHours).toBeGreaterThanOrEqual(0);
      expect(member.elevationDeltaM).not.toBeNull();
      expect(member.benched).toBeNull();
    }
    expect(comparison.newestReferenceTime).toBe(
      comparison.members
        .map((member) => member.referenceTime)
        .sort()
        .at(-1),
    );
  });

  it("echoes the one threshold set and carries the unavailable roster through", () => {
    expect(comparison.thresholds).toEqual(DEFAULT_ANALYZE_THRESHOLDS);
    expect(comparison.unavailable).toEqual([{ model: "nam-conus-nest", miss: "absent" }]);
    const version: number = comparison.vocabularyVersion;
    expect(version).toBe(COMPARE_VOCABULARY_VERSION);
  });

  it("benches a member whose lift never reaches launch — the GEPS case, by arithmetic", () => {
    const deficit = load("gepsFlagpole");
    (deficit.site as { id: string }).id = "erie";
    const withBenched = compareForecasts([hrrr(), reps(), deficit], {
      timeZone: TZ,
      launch: ERIE_LAUNCH,
    });
    const benched = withBenched.members.find((member) => member.model === "geps")!;
    expect(benched.benched).toMatchObject({ reason: "terrainMismatch" });
    for (const finding of ofKind<WindowAgreementFinding>(withBenched.findings, "windowAgreement")) {
      expect(finding.windows.map((vote) => vote.model)).not.toContain("geps");
      expect(finding.quiet.map((vote) => vote.model)).not.toContain("geps");
      expect(finding.abstained.map((entry) => entry.model)).not.toContain("geps");
    }
    const edge = ofKind<WindowAgreementFinding>(withBenched.findings, "windowAgreement").find(
      (finding) => finding.day === "2026-08-10",
    )!;
    expect(edge.voters).toBe(0);
    expect(edge.unanimous).toBeNull();
    expect(edge.abstained.map((entry) => ({ model: entry.model, reason: entry.reason }))).toEqual([
      { model: "hrrr-conus", reason: "outOfHorizon" },
      { model: "reps", reason: "outOfHorizon" },
    ]);
  });

  it("benches nobody without a launch — terrainMismatch is a launch statement", () => {
    const deficit = load("gepsFlagpole");
    (deficit.site as { id: string }).id = "erie";
    const launchFree = compareForecasts([hrrr(), reps(), deficit], { timeZone: TZ });
    expect(launchFree.site.launchAltitudeM).toBeNull();
    for (const member of launchFree.members) {
      expect(member.benched).toBeNull();
      expect(member.launchAltitudeM).toBeNull();
      expect(member.elevationDeltaM).toBeNull();
    }
    expect(ofKind<HeightSpreadFinding>(launchFree.findings, "heightSpread")).toEqual([]);
  });
});

describe("windowAgreement", () => {
  const comparison = compareForecasts([hrrr(), reps()], { timeZone: TZ, launch: ERIE_LAUNCH });
  const agreement = ofKind<WindowAgreementFinding>(comparison.findings, "windowAgreement");
  const byDay = Object.fromEntries(agreement.map((finding) => [finding.day, finding]));

  it("is unanimous where both members forecast a window", () => {
    expect(byDay["2026-08-08"].voters).toBe(2);
    expect(byDay["2026-08-08"].unanimous).toBe(true);
    expect(byDay["2026-08-08"].windows.map((vote) => vote.model).sort()).toEqual([
      "hrrr-conus",
      "reps",
    ]);
    expect(byDay["2026-08-08"].quiet).toEqual([]);
    expect(byDay["2026-08-08"].abstained).toEqual([]);
  });

  it("keeps clipped edges out of the timing envelope — they are data boundaries", () => {
    expect(byDay["2026-08-08"].timing.starts).toEqual([]);
    expect(byDay["2026-08-08"].timing.startSpreadHours).toBeNull();
    expect(byDay["2026-08-08"].timing.endSpreadHours).toBe(4);
    expect(byDay["2026-08-09"].timing.startSpreadHours).toBe(0);
    expect(byDay["2026-08-09"].timing.ends).toEqual([]);
    expect(byDay["2026-08-09"].timing.endSpreadHours).toBeNull();
  });

  it("echoes each timing vote's cadence and states the widest step beside the spread", () => {
    const starts = byDay["2026-08-09"].timing.starts;
    expect(Object.fromEntries(starts.map((entry) => [entry.model, entry.stepHours]))).toEqual({
      "hrrr-conus": 1,
      reps: 3,
    });
    expect(byDay["2026-08-09"].timing.startStepHoursMax).toBe(3);
    expect(byDay["2026-08-09"].timing.endStepHoursMax).toBeNull();
    expect(byDay["2026-08-08"].timing.endStepHoursMax).toBe(3);
    expect(byDay["2026-08-08"].timing.startStepHoursMax).toBeNull();
  });

  it("turns truncated quiet days into abstentions, never votes — and keeps the day (zero voters, nonzero abstentions)", () => {
    const quiet = compareForecasts([hrrr(), reps()], {
      timeZone: TZ,
      launch: ERIE_LAUNCH,
      thresholds: { thermalWindow: { wstarMinMps: 99, depthMinM: 300 } },
    });
    const findings = ofKind<WindowAgreementFinding>(quiet.findings, "windowAgreement");
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.windows).toEqual([]);
      expect(finding.quiet).toEqual([]);
      expect(finding.voters).toBe(0);
      expect(finding.unanimous).toBeNull();
      expect(finding.abstained.length).toBeGreaterThan(0);
      for (const abstention of finding.abstained) {
        expect(abstention.reason).toBe("truncatedDay");
      }
      expect(finding.sensitivity).toEqual({ wstarFlipAtMps: null, depthFlipAtM: null });
    }
  });
});

describe("the midnight electorate", () => {
  const twoDays = (
    day1: string,
    day2: string,
    spec: (validAt: string) => Omit<HourSpec, "validAt">,
  ) =>
    [...fullDay(day1, () => QUIET), ...fullDay(day2, () => QUIET)].map((hour) => ({
      ...hour,
      ...spec(hour.validAt),
    }));
  const spannerHours = new Set([5, 6, 7, 8, 9].map((utcHour) => `2026-08-09T0${utcHour}:00:00Z`));
  const detA = detMember({
    model: "det-a",
    referenceTime: "2026-08-08T06:00:00Z",
    hours: twoDays("2026-08-08", "2026-08-09", (validAt) =>
      spannerHours.has(validAt) ? { wstar: 1.2, top: 1847 } : QUIET,
    ),
  });
  const detB = detMember({
    model: "det-b",
    referenceTime: "2026-08-08T06:00:00Z",
    hours: twoDays("2026-08-08", "2026-08-09", () => ({ wstar: 0.2, top: 1350 })),
  });
  const comparison = compareForecasts([detA, detB], { timeZone: TZ, launch: ERIE_LAUNCH });
  const byDay = Object.fromEntries(
    ofKind<WindowAgreementFinding>(comparison.findings, "windowAgreement").map((finding) => [
      finding.day,
      finding,
    ]),
  );

  it("votes the spanning window on BOTH days it touches — no silently shrunken electorate", () => {
    for (const day of ["2026-08-08", "2026-08-09"]) {
      expect(byDay[day].voters).toBe(2);
      expect(byDay[day].unanimous).toBe(false);
      expect(byDay[day].windows.map((vote) => vote.model)).toEqual(["det-a"]);
      expect(byDay[day].quiet.map((vote) => vote.model)).toEqual(["det-b"]);
      expect(byDay[day].abstained).toEqual([]);
    }
  });

  it("marks the second day's vote viaWindowFrom — the numbers describe the whole window", () => {
    expect(byDay["2026-08-08"].windows[0].viaWindowFrom).toBeUndefined();
    expect(byDay["2026-08-09"].windows[0].viaWindowFrom).toBe("2026-08-08");
    expect(byDay["2026-08-09"].windows[0].start.validAt).toBe("2026-08-09T05:00:00Z");
    expect(byDay["2026-08-09"].windows[0].end.validAt).toBe("2026-08-09T09:00:00Z");
    expect(byDay["2026-08-09"].windows[0].durationHours).toBe(5);
  });

  it("assigns each timing edge to the day containing its instant", () => {
    expect(byDay["2026-08-08"].timing.starts.map((entry) => entry.at.local)).toEqual([
      "2026-08-08T22:00",
    ]);
    expect(byDay["2026-08-08"].timing.ends).toEqual([]);
    expect(byDay["2026-08-09"].timing.starts).toEqual([]);
    expect(byDay["2026-08-09"].timing.ends.map((entry) => entry.at.local)).toEqual([
      "2026-08-09T02:00",
    ]);
  });

  it("states the sensitivity arithmetic from the voters' own peaks", () => {
    for (const day of ["2026-08-08", "2026-08-09"]) {
      expect(byDay[day].sensitivity).toEqual({ wstarFlipAtMps: 1.2, depthFlipAtM: 103 });
    }
  });

  it("keeps the peak with the day it fires in — no heightSpread from a one-peak day", () => {
    expect(ofKind<HeightSpreadFinding>(comparison.findings, "heightSpread")).toEqual([]);
  });
});

describe("outOfHorizon abstentions", () => {
  const windowSpec = (localHour: number) =>
    localHour >= 11 && localHour <= 13 ? { wstar: 1.2, top: 1847 } : QUIET;
  const runA = detMember({
    model: "det-c",
    referenceTime: "2026-08-08T06:00:00Z",
    hours: fullDay("2026-08-08", windowSpec),
  });
  const runB = detMember({
    model: "det-c",
    referenceTime: "2026-08-09T06:00:00Z",
    hours: fullDay("2026-08-09", windowSpec),
  });
  const comparison = compareForecasts([runA, runB], { timeZone: TZ, launch: ERIE_LAUNCH });
  const byDay = Object.fromEntries(
    ofKind<WindowAgreementFinding>(comparison.findings, "windowAgreement").map((finding) => [
      finding.day,
      finding,
    ]),
  );

  it("rosters the member that never reaches the day, with its reason", () => {
    expect(byDay["2026-08-08"].voters).toBe(1);
    expect(byDay["2026-08-08"].unanimous).toBeNull();
    expect(byDay["2026-08-08"].windows.map((vote) => vote.member)).toEqual([
      "det-c@2026-08-08T06:00:00Z",
    ]);
    expect(byDay["2026-08-08"].abstained).toEqual([
      { member: "det-c@2026-08-09T06:00:00Z", model: "det-c", reason: "outOfHorizon" },
    ]);
    expect(byDay["2026-08-09"].windows.map((vote) => vote.member)).toEqual([
      "det-c@2026-08-09T06:00:00Z",
    ]);
    expect(byDay["2026-08-09"].abstained).toEqual([
      { member: "det-c@2026-08-08T06:00:00Z", model: "det-c", reason: "outOfHorizon" },
    ]);
  });

  it("states single-voter sensitivity from the lone window vote's peaks", () => {
    expect(byDay["2026-08-08"].sensitivity).toEqual({ wstarFlipAtMps: 1.2, depthFlipAtM: 600 });
  });
});

describe("zero-voter suppression", () => {
  it("suppresses a day only at zero voters AND zero abstentions", () => {
    const deficit = load("gepsFlagpole");
    (deficit.site as { id: string }).id = "erie";
    const comparison = compareForecasts([deficit], { timeZone: TZ, launch: ERIE_LAUNCH });
    expect(comparison.members[0].benched).toMatchObject({ reason: "terrainMismatch" });
    expect(ofKind<WindowAgreementFinding>(comparison.findings, "windowAgreement")).toEqual([]);
  });
});

describe("windDivergence", () => {
  const divMember = (
    model: string,
    bandWindMps: number,
    gustMps: number,
    gustSemantics?: "hourMax" | "instant",
  ) =>
    detMember({
      model,
      referenceTime: "2026-08-08T06:00:00Z",
      ...(gustSemantics ? { gustSemantics } : {}),
      hours: fullDay("2026-08-08", (localHour) => ({
        ...(localHour >= 11 && localHour <= 13 ? { wstar: 1.2, top: 1847 } : QUIET),
        wind: { speedMps: 0.5, directionDeg: 90 },
        gustMps,
        levels: [
          { heightM: 1500, windSpeedMps: bandWindMps, windDirectionDeg: 270, pressureHpa: 850 },
          { heightM: 3000, windSpeedMps: 20, windDirectionDeg: 270, pressureHpa: 700 },
        ],
      })),
    });
  const comparison = compareForecasts(
    [
      divMember("div-a", 5, 10, "hourMax"),
      divMember("div-b", 7.5, 6, "instant"),
      divMember("div-c", 6, 8),
    ],
    { timeZone: TZ, launch: ERIE_LAUNCH },
  );
  const divergence = ofKind<WindDivergenceFinding>(comparison.findings, "windDivergence");

  it("rosters every voter's in-window band maximum with the mandatory elevation echo", () => {
    expect(divergence).toHaveLength(1);
    const finding = divergence[0];
    expect(finding.day).toBe("2026-08-08");
    expect(finding.bandWind.entries).toHaveLength(3);
    expect(
      finding.bandWind.entries.map((entry) => ({ model: entry.model, windMps: entry.windMps })),
    ).toEqual([
      { model: "div-a", windMps: 5 },
      { model: "div-b", windMps: 7.5 },
      { model: "div-c", windMps: 6 },
    ]);
    for (const entry of finding.bandWind.entries) {
      expect(entry.modelElevationM).toBe(1177.6);
      expect(entry.heightM).toBe(1500);
      expect(entry.scope).toBe("duringWindow");
      expect(entry.at.local).toBe("2026-08-08T11:00");
    }
    expect(finding.bandWind.spreadMps).toBe(2.5);
  });

  it("never pools gusts across semantics classes — undeclared rosters without a spread", () => {
    const gust = divergence[0].gust;
    expect(gust.hourMax.entries.map((entry) => entry.model)).toEqual(["div-a"]);
    expect(gust.hourMax.entries[0].gustMps).toBe(10);
    expect(gust.hourMax.spreadMps).toBeNull();
    expect(gust.instant.entries.map((entry) => entry.model)).toEqual(["div-b"]);
    expect(gust.instant.spreadMps).toBeNull();
    expect(gust.undeclared.entries.map((entry) => entry.model)).toEqual(["div-c"]);
    expect("spreadMps" in gust.undeclared).toBe(false);
  });

  it("spreads gusts within one declared class", () => {
    const twin = compareForecasts(
      [divMember("div-a", 5, 10, "hourMax"), divMember("div-d", 6.5, 7.2, "hourMax")],
      { timeZone: TZ, launch: ERIE_LAUNCH },
    );
    const finding = ofKind<WindDivergenceFinding>(twin.findings, "windDivergence")[0];
    expect(finding.gust.hourMax.entries).toHaveLength(2);
    expect(finding.gust.hourMax.spreadMps).toBe(2.8);
    expect(finding.gust.instant.entries).toEqual([]);
    expect(finding.gust.instant.spreadMps).toBeNull();
  });
});

describe("windDirectionSpread", () => {
  const dirMember = (model: string, directionDeg: number, modelElevationM?: number) =>
    detMember({
      model,
      referenceTime: "2026-08-08T18:00:00Z",
      ...(modelElevationM !== undefined ? { modelElevationM } : {}),
      hours: fullDay("2026-08-08", (localHour) => ({
        ...(localHour >= 11 && localHour <= 13 ? { wstar: 1.2, top: 1847 } : QUIET),
        wind: { speedMps: 3, directionDeg },
      })),
    });
  const comparison = compareForecasts(
    [dirMember("dir-a", 90), dirMember("dir-b", 210, 900), reps()],
    {
      timeZone: TZ,
      launch: ERIE_LAUNCH,
    },
  );
  const spreads = ofKind<WindDirectionSpreadFinding>(comparison.findings, "windDirectionSpread");

  it("rosters deterministic voters only, with vector-mean directions and elevations", () => {
    const finding = spreads.find((entry) => entry.day === "2026-08-08")!;
    expect(finding.entries).toEqual([
      {
        member: "dir-a@2026-08-08T18:00:00Z",
        model: "dir-a",
        directionDeg: 90,
        speedMps: 3,
        modelElevationM: 1177.6,
      },
      {
        member: "dir-b@2026-08-08T18:00:00Z",
        model: "dir-b",
        directionDeg: 210,
        speedMps: 3,
        modelElevationM: 900,
      },
    ]);
    expect(finding.thresholds).toEqual({ directionFloorMps: 1 });
  });

  it("states the max circular separation with the pair's elevations riding it", () => {
    const finding = spreads.find((entry) => entry.day === "2026-08-08")!;
    expect(finding.maxAngularSeparationDeg).toBe(120);
    expect(finding.maxSeparation).toEqual({
      members: ["dir-a@2026-08-08T18:00:00Z", "dir-b@2026-08-08T18:00:00Z"],
      models: ["dir-a", "dir-b"],
      modelElevationM: [1177.6, 900],
      elevationDeltaM: 277.6,
    });
  });
});

describe("the percentile carry-through and the heightSpread band", () => {
  type Ev = { members: number; p10: number; p25: number; p50: number; p75: number; p90: number };
  const ev = (p10: number, p25: number, p50: number, p75: number, p90: number): Ev => ({
    members: 21,
    p10,
    p25,
    p50,
    p75,
    p90,
  });
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
      hour("2026-08-09T21:00:00Z", ev(0.5, 0.95, 1.2, 1.5, 1.8), ev(1500, 1600, 1900, 2200, 2500)),
      hour("2026-08-10T00:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-10T03:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-10T06:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-10T09:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-10T12:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-10T18:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-11T00:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-11T06:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-11T12:00:00Z", quietWstar(), quietTop()),
      hour("2026-08-11T18:00:00Z", ev(1.0, 1.2, 1.5, 1.8, 2.0), ev(1600, 1700, 1900, 2100, 2300)),
    ];
    const profile = parseSiteForecast(doc);
    expect(profile).not.toBeNull();
    return profile!;
  }

  const comparison = compareForecasts([crossingFixture(), hrrr()], {
    timeZone: TZ,
    launch: ERIE_LAUNCH,
  });
  const byDay = Object.fromEntries(
    ofKind<WindowAgreementFinding>(comparison.findings, "windowAgreement").map((finding) => [
      finding.day,
      finding,
    ]),
  );

  it("carries the member's minimal passing percentile onto its window vote", () => {
    const votes = byDay["2026-08-09"].windows;
    expect(votes.find((vote) => vote.model === "reps")!.minimalPassingPercentile).toBe("p25");
    expect(votes.find((vote) => vote.model === "hrrr-conus")!.minimalPassingPercentile).toBeNull();
  });

  it("leaves the token null where every percentile agrees — no crossing, not confidence", () => {
    const votes = byDay["2026-08-11"].windows;
    expect(votes).toHaveLength(1);
    expect(votes[0].model).toBe("reps");
    expect(votes[0].minimalPassingPercentile).toBeNull();
  });

  it("gives the ensemble peak its own launch-relative p10–p90 band as context", () => {
    const spread = ofKind<HeightSpreadFinding>(comparison.findings, "heightSpread").find(
      (finding) => finding.day === "2026-08-09",
    )!;
    const repsPeak = spread.peaks.find((peak) => peak.model === "reps")!;
    expect(repsPeak.peakLiftTopAboveLaunchM).toBe(653);
    expect(repsPeak.at.validAt).toBe("2026-08-09T21:00:00Z");
    expect(repsPeak.bandP10P90AboveLaunchM).toEqual([253, 1253]);
    const hrrrPeak = spread.peaks.find((peak) => peak.model === "hrrr-conus")!;
    expect(hrrrPeak.bandP10P90AboveLaunchM).toBeNull();
  });
});

describe("heightSpread", () => {
  const comparison = compareForecasts([hrrr(), reps()], { timeZone: TZ, launch: ERIE_LAUNCH });
  const spreads = ofKind<HeightSpreadFinding>(comparison.findings, "heightSpread");

  it("states launch-relative peaks per member with the spread — and no aggregate", () => {
    expect(spreads.length).toBeGreaterThan(0);
    for (const finding of spreads) {
      expect(finding.peaks.length).toBeGreaterThanOrEqual(2);
      const values = finding.peaks.map((peak) => peak.peakLiftTopAboveLaunchM);
      expect(finding.spreadM).toBeCloseTo(Math.max(...values) - Math.min(...values), 6);
      expect(Object.keys(finding).sort()).toEqual(["day", "kind", "peaks", "spreadM"]);
    }
  });
});
