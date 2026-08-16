import { describe, expect, it } from "vitest";
import { analyzeForecast } from "../src/analyze/index.js";
import { compareAnalyses, comparisonMemberKey } from "../src/compare.js";
import type { SiteForecast } from "../src/contract.js";
import { localHourOfDay } from "../src/derive/day-window.js";
import {
  buildCompareBoardScene,
  compareBoardDayAxis,
  xForBoardTime,
} from "../src/compare-board/index.js";
import { deterministicSceneProfile, SCENE_LAUNCH } from "./scene-fixtures.js";
import {
  BOARD_ANALYZE_OPTIONS as ANALYZE,
  BOARD_CEILINGS as CEILINGS,
  BOARD_DAY as DAY,
  BOARD_TZ as TZ,
  boardAnalyses,
} from "./compare-board-fixtures.js";

const BOARD = { dateKey: DAY, timeZone: TZ };

function boardScene() {
  const analyses = boardAnalyses();
  return buildCompareBoardScene(analyses, compareAnalyses(analyses), BOARD);
}

describe("compareBoardDayAxis", () => {
  it("resolves the local day span through Intl — start and end read as the local hours asked for", () => {
    const axis = compareBoardDayAxis(BOARD);
    expect(localHourOfDay(new Date(axis.startMs).toISOString(), TZ)).toBe(7);
    expect(localHourOfDay(new Date(axis.endMs).toISOString(), TZ)).toBe(21);
    expect(axis.endMs - axis.startMs).toBe(14 * 3_600_000);
  });

  it("is exact in UTC and honours custom hours and ticks", () => {
    const axis = compareBoardDayAxis({
      dateKey: DAY,
      timeZone: "UTC",
      dayStartHour: 6,
      dayEndHour: 20,
      tickHours: [6, 12, 18, 23],
    });
    expect(axis.startMs).toBe(Date.parse("2026-08-09T06:00:00Z"));
    expect(axis.endMs).toBe(Date.parse("2026-08-09T20:00:00Z"));
    /* Ticks outside the span are dropped, never clamped into a lie. */
    expect(axis.ticks.map((tick) => tick.hour)).toEqual([6, 12, 18]);
    expect(axis.ticks[1].x).toBeCloseTo(6 / 14, 10);
  });

  it("keeps the axis honest across a DST transition day", () => {
    /* The historical fall-back day (2025-11-02, 02:00 → 01:00): the
       default 07–21 span sits entirely after the transition and stays
       fourteen hours, but both edges still read as the local hours asked
       for — the Intl round-trip, not offset arithmetic, is the contract. */
    const day = compareBoardDayAxis({ dateKey: "2025-11-02", timeZone: TZ });
    expect(localHourOfDay(new Date(day.startMs).toISOString(), TZ)).toBe(7);
    expect(localHourOfDay(new Date(day.endMs).toISOString(), TZ)).toBe(21);
    expect(day.endMs - day.startMs).toBe(14 * 3_600_000);
    /* A span crossing the transition carries the repeated hour: local
       midnight to 21:00 is twenty-two absolute hours on this day. */
    const crossing = compareBoardDayAxis({
      dateKey: "2025-11-02",
      timeZone: TZ,
      dayStartHour: 0,
      dayEndHour: 21,
    });
    expect(localHourOfDay(new Date(crossing.startMs).toISOString(), TZ)).toBe(0);
    expect(localHourOfDay(new Date(crossing.endMs).toISOString(), TZ)).toBe(21);
    expect(crossing.endMs - crossing.startMs).toBe(22 * 3_600_000);
  });

  it("refuses malformed day keys and impossible hour ranges", () => {
    expect(() => compareBoardDayAxis({ dateKey: "2026-8-9", timeZone: TZ })).toThrow(
      /localDateKey-shaped/,
    );
    expect(() =>
      compareBoardDayAxis({ dateKey: DAY, timeZone: TZ, dayStartHour: 12, dayEndHour: 9 }),
    ).toThrow(/start < end/);
  });

  it("xForBoardTime maps the span to 0..1 and clamps at the edges", () => {
    const axis = compareBoardDayAxis(BOARD);
    expect(xForBoardTime(axis, axis.startMs)).toBe(0);
    expect(xForBoardTime(axis, axis.endMs)).toBe(1);
    expect(xForBoardTime(axis, (axis.startMs + axis.endMs) / 2)).toBeCloseTo(0.5, 10);
    expect(xForBoardTime(axis, axis.startMs - 3_600_000)).toBe(0);
    expect(xForBoardTime(axis, axis.endMs + 3_600_000)).toBe(1);
  });
});

describe("buildCompareBoardScene", () => {
  const scene = boardScene();
  const byModel = new Map(scene.rows.map((row) => [row.model, row]));

  it("keeps the rows in comparison order with member identity and document kind", () => {
    expect(scene.rows.map((row) => row.model)).toEqual(["hrdps-continental", "gfs", "reps"]);
    expect(scene.rows.map((row) => row.kind)).toEqual([
      "deterministic",
      "deterministic",
      "ensemble",
    ]);
    expect(scene.rows[0].member).toBe(
      comparisonMemberKey("hrdps-continental", "2026-08-09T00:00:00Z"),
    );
  });

  it("widens window bars by the finding's own step while the cited end stays honest", () => {
    const row = byModel.get("hrdps-continental")!;
    expect(row.windows).toHaveLength(1);
    const window = row.windows[0];
    expect(window.startMs).toBe(Date.parse("2026-08-09T16:00:00Z"));
    expect(window.endCitedMs).toBe(Date.parse("2026-08-09T21:00:00Z"));
    expect(window.endMs).toBe(window.endCitedMs + 3_600_000);
    expect(window.x1).toBeGreaterThan(window.x1Cited);
    /* 16:00Z is 09:00 local — two hours into the 07–21 span. */
    expect(window.x0).toBeCloseTo(2 / 14, 10);
    expect(window.clippedAtEnd).toBe(true);
    expect(window.clippedAtStart).toBe(false);
  });

  it("carries exceedance spans per quantity with the caller's ceiling echoed", () => {
    const row = byModel.get("hrdps-continental")!;
    const quantities = row.exceedances.map((entry) => entry.quantity).sort();
    expect(quantities).toEqual(["bandWind", "surfaceWind"]);
    const surface = row.exceedances.find((entry) => entry.quantity === "surfaceWind")!;
    expect(surface.thresholdMps).toBe(CEILINGS.surfaceMps);
    expect(surface.runs[0].peakMps).toBeGreaterThanOrEqual(CEILINGS.surfaceMps!);
    expect(row.overCeiling).toEqual({ surfaceWind: true, gust: false, bandWind: true });
  });

  it("reads the gust class only where the document declares one, and never pools the classes", () => {
    const undeclared = byModel.get("hrdps-continental")!;
    expect(undeclared.gust).toBeNull();
    const declared = byModel.get("gfs")!;
    expect(declared.gust?.semantics).toBe("instant");
    expect(declared.gust?.scope).toBe("duringWindow");
    /* The instant-class ceiling produced the gust exceedance. */
    const gustExceedance = declared.exceedances.find((entry) => entry.quantity === "gust")!;
    expect(gustExceedance.gustSemantics).toBe("instant");
    expect(gustExceedance.thresholdMps).toBe(CEILINGS.gust!.instantMps);
  });

  it("states storms as structured capTiming data with the break on the axis", () => {
    const row = byModel.get("gfs")!;
    expect(row.storms?.source).toBe("capTiming");
    expect(row.storms?.verdict).toBe("capBreaks");
    expect(row.storms?.capBreak?.kind).toBe("at");
    /* Cap breaks at the first broken hour, 16:00Z = 09:00 local. */
    expect(row.storms?.capBreak?.startMs).toBe(Date.parse("2026-08-09T16:00:00Z"));
    expect(row.storms?.capBreak?.x0).toBeCloseTo(2 / 14, 10);
    expect(row.rainStart?.source).toBe("capTiming");
    expect(row.rainStart?.atMs).toBe(Date.parse("2026-08-09T18:00:00Z"));
  });

  it("fills the launch cell from the windDirection finding's own endpoint samples", () => {
    const row = byModel.get("hrdps-continental")!;
    expect(row.launch).not.toBeNull();
    expect(row.launch!.start.speedMps).toBeCloseTo(1.8, 5);
    expect(row.launch!.end.speedMps).toBeCloseTo(3.8, 5);
    expect(row.launch!.directionFloorMps).toBe(1);
  });

  it("fills aloft and top from windSummary and the day's own windows", () => {
    const row = byModel.get("hrdps-continental")!;
    expect(row.aloft?.scope).toBe("duringWindow");
    expect(row.aloft?.windMps).toBeGreaterThan(0);
    expect(row.top?.liftTopM).toBeCloseTo(3450, 0);
    expect(row.top?.aboveLaunchM).toBeCloseTo(3450 - SCENE_LAUNCH.elevationM, 0);
    /* Cloud base (2600 + 150h) stays well above the lift top — the cited
       peak hour is sink-limited, stated, not defaulted. */
    expect(row.top?.cloudCapped).toBe(false);
  });

  it("blanks what an ensemble's data cannot support instead of zero-filling", () => {
    const row = byModel.get("reps")!;
    expect(row.kind).toBe("ensemble");
    expect(row.vote.kind).toBe("window");
    expect(row.windows).toHaveLength(1);
    /* No CIN/CAPE story, no circular direction statistics, no levels, no
       gust series in this document — every cell states nothing. */
    expect(row.storms).toBeNull();
    expect(row.launch).toBeNull();
    expect(row.aloft).toBeNull();
    expect(row.gust).toBeNull();
    expect(row.rainStart).toBeNull();
    /* The surface series exists, so the ensemble still states exceedance. */
    expect(row.overCeiling.surfaceWind).toBe(true);
  });

  it("orders bare analyses by input and derives votes without a comparison", () => {
    const analyses = boardAnalyses();
    const scene = buildCompareBoardScene([analyses[2], analyses[0]], null, BOARD);
    expect(scene.rows.map((row) => row.model)).toEqual(["reps", "hrdps-continental"]);
    expect(scene.rows.every((row) => row.vote.kind === "window")).toBe(true);
  });
});

describe("buildCompareBoardScene non-votes", () => {
  it("carries the benched reason from the comparison's ledger", () => {
    const lowGround = deterministicSceneProfile();
    const benchedProfile: SiteForecast = {
      ...lowGround,
      model: "gdps",
      site: { ...lowGround.site, modelElevationM: 300 },
      hours: lowGround.hours.map((hour) => ({
        ...hour,
        derived: {
          ...hour.derived,
          usableLiftTopM: hour.derived.usableLiftTopM === null ? null : 800,
        },
      })),
    };
    const analyses = [
      analyzeForecast(deterministicSceneProfile(), ANALYZE),
      analyzeForecast(benchedProfile, ANALYZE),
    ];
    const scene = buildCompareBoardScene(analyses, compareAnalyses(analyses), BOARD);
    const benched = scene.rows.find((row) => row.model === "gdps")!;
    expect(benched.vote).toEqual({ kind: "benched", reason: "terrainMismatch", deltaM: -1185 });
    expect(benched.windows).toHaveLength(0);
  });

  it("states truncatedDay and outOfHorizon abstentions", () => {
    const base = deterministicSceneProfile();
    /* Two early hours whose lift still reaches launch (so terrain never
       benches the member) but clears no floor — a data sliver, not a
       call. */
    const sliver: SiteForecast = {
      ...base,
      model: "gdps",
      hours: base.hours.slice(0, 2).map((hour, h) => ({
        ...hour,
        derived: { ...hour.derived, usableLiftTopM: h === 1 ? 1600 : hour.derived.usableLiftTopM },
      })),
    };
    const analyses = [analyzeForecast(base, ANALYZE), analyzeForecast(sliver, ANALYZE)];
    const scene = buildCompareBoardScene(analyses, compareAnalyses(analyses), BOARD);
    expect(scene.rows.find((row) => row.model === "gdps")!.vote).toEqual({
      kind: "abstained",
      reason: "truncatedDay",
    });

    const nextDay = buildCompareBoardScene(analyses, compareAnalyses(analyses), {
      ...BOARD,
      dateKey: "2026-08-10",
    });
    expect(nextDay.rows.every((row) => row.vote.kind === "abstained")).toBe(true);
    expect(nextDay.rows[0].vote).toEqual({ kind: "abstained", reason: "outOfHorizon" });
  });

  it("states a quiet vote with the floors the day missed", () => {
    const base = deterministicSceneProfile();
    /* A quiet vote needs the whole local day covered — a partial day is
       an abstention, not a call — so this member publishes all 24 local
       hours with lift that reaches launch but weak W*. */
    const isoHour = (offset: number) =>
      new Date(Date.parse("2026-08-09T07:00:00Z") + offset * 3_600_000)
        .toISOString()
        .replace(".000Z", "Z");
    const weak: SiteForecast = {
      ...base,
      model: "gdps",
      hours: Array.from({ length: 24 }, (_, h) => ({
        ...base.hours[3],
        validAt: isoHour(h),
        derived: { ...base.hours[3].derived, thermalVelocityMps: 0.5, usableLiftTopM: 2000 },
      })),
    };
    const analyses = [analyzeForecast(base, ANALYZE), analyzeForecast(weak, ANALYZE)];
    const scene = buildCompareBoardScene(analyses, compareAnalyses(analyses), BOARD);
    const quiet = scene.rows.find((row) => row.model === "gdps")!;
    expect(quiet.vote.kind).toBe("quiet");
    if (quiet.vote.kind === "quiet") {
      expect(quiet.vote.failed).toContain("wstar");
      expect(quiet.vote.peakThermalVelocityMps).toBe(0.5);
    }
  });
});

describe("buildCompareBoardScene coherence", () => {
  const analyses = boardAnalyses();

  it("refuses an empty member list", () => {
    expect(() => buildCompareBoardScene([], null, BOARD)).toThrow(/no members/);
  });

  it("refuses mixed sites, mixed zones, duplicates, and vocabulary skew", () => {
    const foreign = analyzeForecast(
      {
        ...deterministicSceneProfile(),
        site: { ...deterministicSceneProfile().site, id: "elsewhere" },
      },
      ANALYZE,
    );
    expect(() => buildCompareBoardScene([analyses[0], foreign], null, BOARD)).toThrow(
      /mixed sites/,
    );
    expect(() =>
      buildCompareBoardScene([analyses[0]], null, { ...BOARD, timeZone: "UTC" }),
    ).toThrow(/one zone|day keys/);
    expect(() => buildCompareBoardScene([analyses[0], analyses[0]], null, BOARD)).toThrow(
      /duplicate member/,
    );
    const skewed = { ...analyses[0], vocabularyVersion: 4 };
    expect(() => buildCompareBoardScene([skewed], null, BOARD)).toThrow(/vocabulary version skew/);
  });

  it("refuses a member the comparison's ledger does not know", () => {
    const comparison = compareAnalyses([analyses[0], analyses[1]]);
    expect(() => buildCompareBoardScene(analyses, comparison, BOARD)).toThrow(/ledger/);
  });
});
