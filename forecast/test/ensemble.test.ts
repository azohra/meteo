import { describe, expect, it } from "vitest";
import {
  aggregateMemberProfiles,
  circularMedian,
  countCeiledMembers,
  percentile,
  percentileBlock,
  type MemberHour,
  type MemberProfile,
} from "../src/ensemble.js";

function level(
  pressureHpa: number,
  heightM: number,
  overrides: Record<string, number> = {},
): MemberHour["levels"][number] {
  return {
    pressureHpa,
    heightM,
    temperatureC: 5.0,
    dewPointC: 1.0,
    windSpeedMps: 6.0,
    windDirectionDeg: 270.0,
    ...overrides,
  };
}

function memberHour({
  temperatureC,
  directionDeg,
  levels,
  boundaryLayerTopM,
  cloudBaseM,
  capeJkg,
}: {
  temperatureC: number;
  directionDeg: number;
  levels: MemberHour["levels"];
  boundaryLayerTopM: number | null;
  cloudBaseM: number | null;
  capeJkg?: number;
}): MemberHour {
  const surface: MemberHour["surface"] = {
    temperatureC,
    windDirectionDeg: directionDeg,
  };
  if (capeJkg !== undefined) {
    surface.capeJkg = capeJkg;
  }
  return {
    validAt: "2026-08-09T18:00:00Z",
    surface,
    levels,
    derived: {
      boundaryLayerTopM,
      cloudBaseM,
    },
  };
}

function aggregate(
  profiles: MemberProfile[],
  { optionalSurfaceScalars = [] as readonly string[] } = {},
) {
  return aggregateMemberProfiles(profiles, {
    surfaceScalars: ["temperatureC", "windDirectionDeg", "capeJkg"],
    levelScalars: ["heightM", "temperatureC", "dewPointC", "windSpeedMps"],
    derivedScalars: ["boundaryLayerTopM", "cloudBaseM"],
    censoredScalars: ["boundaryLayerTopM"],
    optionalSurfaceScalars,
  });
}

describe("ensemble aggregation", () => {
  it("percentile interpolates sorted values and rejects an empty sample", () => {
    expect(percentile([1.0, 2.0, 3.0, 4.0], 25)).toBeCloseTo(1.75, 9);
    expect(() => percentile([], 50)).toThrowError(/no values/);
  });

  it("circular median uses the short arc across north", () => {
    expect(circularMedian([350.0, 355.0, 5.0, 10.0, 15.0])).toBeCloseTo(5.0, 9);
    expect(() => circularMedian([])).toThrowError(/no bearings/);
  });

  it("percentile block counts only defined members", () => {
    expect(percentileBlock([null, 10.0, 20.0])).toEqual({
      members: 2,
      p10: 11.0,
      p25: 12.5,
      p50: 15.0,
      p75: 17.5,
      p90: 19.0,
    });
    expect(percentileBlock([null, null])).toEqual({
      members: 0,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
    });
  });

  it("whole profiles share member, level, optional, and censoring semantics", () => {
    const profiles: MemberProfile[] = [
      {
        hours: [
          memberHour({
            temperatureC: 10.0,
            directionDeg: 350.0,
            levels: [level(850, 1500.0), level(500, 5500.0)],
            boundaryLayerTopM: 5500.0,
            cloudBaseM: null,
          }),
        ],
      },
      {
        hours: [
          memberHour({
            temperatureC: 20.0,
            directionDeg: 10.0,
            levels: [level(500, 5600.0)],
            boundaryLayerTopM: 2000.0,
            cloudBaseM: 2500.0,
            capeJkg: 800.0,
          }),
        ],
      },
    ];

    const [hour] = aggregate(profiles, { optionalSurfaceScalars: ["capeJkg"] });
    const surface = hour.surface as Record<string, Record<string, number>>;
    const levels = hour.levels as Array<Record<string, Record<string, number> | number>>;
    const derived = hour.derived as Record<string, Record<string, number>>;

    expect(hour.validAt).toBe("2026-08-09T18:00:00Z");
    expect(surface.temperatureC.members).toBe(2);
    expect(surface.temperatureC.p50).toBeCloseTo(15.0, 9);
    expect(surface.windDirectionDeg).toBeCloseTo(0.0, 9);
    expect(surface.capeJkg.members).toBe(1);
    expect(levels[0].pressureHpa).toBe(850);
    expect((levels[0].heightM as Record<string, number>).members).toBe(1);
    expect(levels[1].pressureHpa).toBe(500);
    expect((levels[1].heightM as Record<string, number>).members).toBe(2);
    expect(derived.boundaryLayerTopM.members).toBe(2);
    expect(derived.boundaryLayerTopM.ceiledMembers).toBe(1);
    expect(derived.cloudBaseM.members).toBe(1);
    expect("ceiledMembers" in derived.cloudBaseM).toBe(false);
  });

  it("only explicitly optional surface fields may be absent", () => {
    const profiles: MemberProfile[] = [
      {
        hours: [
          memberHour({
            temperatureC: 10.0,
            directionDeg: 270.0,
            levels: [level(500, 5500.0)],
            boundaryLayerTopM: 2000.0,
            cloudBaseM: 2500.0,
          }),
        ],
      },
    ];

    expect(() => aggregate(profiles)).toThrowError(/capeJkg/);
  });

  it("ceiling tolerance counts float round-trip without counting nulls", () => {
    const memberHours = [
      memberHour({
        temperatureC: 10.0,
        directionDeg: 270.0,
        levels: [level(500, 5500.0)],
        boundaryLayerTopM: 5499.6,
        cloudBaseM: null,
      }),
      memberHour({
        temperatureC: 10.0,
        directionDeg: 270.0,
        levels: [level(500, 5500.0)],
        boundaryLayerTopM: null,
        cloudBaseM: null,
      }),
    ];

    expect(countCeiledMembers(memberHours, "boundaryLayerTopM")).toBe(1);
  });
});
