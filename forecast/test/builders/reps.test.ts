import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DecodeJ2k, J2kSamples } from "@azohra/meteo.grib";
import {
  FETCH_CONCURRENCY,
  FORECAST_HOURS,
  MEMBER_COUNT,
  PERTURBATION_NUMBERS,
  PRESSURE_LEVELS,
  SEMANTICS,
  SLUG,
  STEP_HOURS,
  SURFACE_SCALARS,
  WIND_LEVEL_TOKENS,
  aggregateHours,
  buildDocuments,
  buildReps,
  fileUrl,
  forecastHoursFromSteps,
  sampleScalarMembers,
  sampleWindMembers,
} from "../../src/builders/reps.js";
import { circularMedian, percentile, type MemberProfile } from "../../src/ensemble.js";
import { splitMembers } from "../../src/history.js";
import { dewPointDepression } from "../../src/moisture.js";
import type { Site } from "../../src/sites.js";
import { DownloadCounters } from "../../src/providers/transport.js";
import { stubFetch, useCleanWireEnv } from "../helpers/wire.js";

useCleanWireEnv();

const DUNDEE = { latitude: 49.291977, longitude: -117.183569 };
const SITE: Site = {
  slug: "dundee",
  name: "Dundee",
  latitude: DUNDEE.latitude,
  longitude: DUNDEE.longitude,
  timeZone: "America/Vancouver",
};

/** Tests feed DRT 5.0 fields, so the JPEG 2000 seam must never fire. */
const noJ2k: DecodeJ2k = () => {
  throw new Error("tests decode simple packing only");
};

function u16be(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function i32sm(value: number): number[] {
  return u32be((Math.abs(value) | (value < 0 ? 0x80000000 : 0)) >>> 0);
}
function f32be(value: number): number[] {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return [view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)];
}
function section(number: number, body: number[]): number[] {
  return [...u32be(body.length + 5), number, ...body];
}

const MICRO = 1e6;

/** Section 3: a 3×3 grid around Dundee — template 3.1 with the identity
 * rotation (south pole at the true south pole) by default, so expected
 * winds equal the raw components; template 3.0 when rotated=false. */
function gridSection(rotated: boolean, uvRelative: number): number[] {
  const body = [
    0, // source: template-defined
    ...u32be(9), // numberOfDataPoints
    0, // no optional list
    0, // interpretation
    ...u16be(rotated ? 1 : 0), // template
    6, // shapeOfTheEarth: sphere 6 371 229 m
    0,
    ...u32be(0),
    0,
    ...u32be(0),
    0,
    ...u32be(0),
    ...u32be(3), // Ni
    ...u32be(3), // Nj
    ...u32be(0), // basic angle
    ...u32be(0), // subdivisions
    ...i32sm(Math.round(49.2 * MICRO)), // la1
    ...u32be(Math.round(242.7 * MICRO)), // lo1
    0x30 | (uvRelative ? 0x08 : 0), // resolution/component flags
    ...i32sm(Math.round(49.4 * MICRO)), // la2
    ...u32be(Math.round(242.9 * MICRO)), // lo2
    ...u32be(Math.round(0.1 * MICRO)), // i increment
    ...u32be(Math.round(0.1 * MICRO)), // j increment
    0x40, // scanning mode: jScansPositively
  ];
  if (rotated) {
    body.push(
      ...i32sm(-90 * MICRO), // south pole at the true south pole: identity
      ...u32be(0),
      ...f32be(0.0), // angle of rotation
    );
  }
  return section(3, body);
}

/** One member's message: PDT 4.1 (ensemble) with the perturbation number,
 * DRT 5.0 with bitsPerValue 0 — the whole field decodes to the float32
 * reference value, the constant-field idiom. With jpeg2000, DRT 5.40
 * instead: the injected decode seam must fire, and the one-byte section 7
 * payload (the perturbation number) stands in for a codestream. */
export function ensembleMessage(
  perturbation: number,
  value: number,
  {
    rotated = true,
    uvRelative = 1,
    jpeg2000 = false,
  }: { rotated?: boolean; uvRelative?: number; jpeg2000?: boolean } = {},
): Uint8Array {
  const section1 = section(1, [
    ...u16be(54), // centre: CMC
    ...u16be(0),
    28, // tables version
    0,
    1, // significance: start of forecast
    ...u16be(2026),
    8,
    7,
    0,
    0,
    0,
    0, // production status
    4, // type: perturbed forecast
  ]);
  const section4 = section(4, [
    ...u16be(0), // no coordinate values
    ...u16be(1), // template 4.1: ensemble at a point in time
    0, // parameterCategory
    0, // parameterNumber
    4, // typeOfGeneratingProcess: ensemble
    0,
    0,
    ...u16be(0),
    0,
    1, // unit of time: hour
    ...u32be(3), // forecastTime
    1, // first fixed surface: ground
    0,
    ...u32be(0),
    255, // no second fixed surface
    255,
    ...u32be(0xffffffff),
    perturbation === 0 ? 1 : 4, // typeOfEnsembleForecast
    perturbation,
    MEMBER_COUNT,
  ]);
  const section5 = jpeg2000
    ? section(5, [
        ...u32be(9), // numberOfValues
        ...u16be(40), // DRT 5.40: JPEG 2000
        ...f32be(0), // reference 0, scales 0: value = the raw sample
        ...u16be(0), // binary scale
        ...u16be(0), // decimal scale
        8, // bitsPerValue nonzero: the codestream decoder must run
        0, // original field type: float
        0, // compression type: lossless
        255, // target compression ratio: missing
      ])
    : section(5, [
        ...u32be(9), // numberOfValues
        ...u16be(0), // DRT 5.0: simple packing
        ...f32be(value), // reference value — the constant field
        ...u16be(0), // binary scale
        ...u16be(0), // decimal scale
        0, // bitsPerValue 0: every point is the reference value
        0, // original field type: float
      ]);
  const sections = [
    ...section1,
    ...gridSection(rotated, uvRelative),
    ...section4,
    ...section5,
    ...section(6, [255]), // no bitmap
    ...section(7, jpeg2000 ? [perturbation] : []),
  ];
  const total = 16 + sections.length + 4;
  return Uint8Array.from([
    0x47,
    0x52,
    0x49,
    0x42, // "GRIB"
    0,
    0, // reserved
    0, // discipline
    2, // edition
    ...u32be(0),
    ...u32be(total), // total length (u64)
    ...sections,
    0x37,
    0x37,
    0x37,
    0x37, // "7777"
  ]);
}

export function ensembleFile(
  valueForMember: (member: number) => number,
  {
    members = PERTURBATION_NUMBERS,
    uvRelative = 1,
    jpeg2000 = false,
  }: { members?: readonly number[]; uvRelative?: number; jpeg2000?: boolean } = {},
): Uint8Array {
  const parts = members.map((member) =>
    ensembleMessage(member, valueForMember(member), { uvRelative, jpeg2000 }),
  );
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const file = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    file.set(part, offset);
    offset += part.length;
  }
  return file;
}

it("the published points land on exact ranks for 21 members", () => {
  const values = Array.from({ length: 21 }, (_unused, index) => index);

  expect(percentile(values, 10)).toBe(2);
  expect(percentile(values, 25)).toBe(5);
  expect(percentile(values, 50)).toBe(10);
  expect(percentile(values, 75)).toBe(15);
  expect(percentile(values, 90)).toBe(18);
});

it("the circular median crosses the wrap and shrugs off a stray member", () => {
  expect(circularMedian([350.0, 355.0, 5.0, 10.0, 15.0])).toBeCloseTo(5.0, 9);
  expect(circularMedian([355.0, 0.0, 5.0, 170.0])).toBeCloseTo(2.5, 9);
});

it("Datamart URLs follow the MSC naming scheme", () => {
  expect(fileUrl("TMP_ISBL-0850", "20260807", "12", 24)).toBe(
    "https://dd.weather.gc.ca/20260807/WXO-DD/ensemble/reps/10km/grib2/12/024/" +
      "20260807T12Z_MSC_REPS_TMP_ISBL-0850_RLatLon0.09x0.09_PT024H.grib2",
  );
});

it("Datamart URLs honour the base override", () => {
  process.env["METEO_DATAMART_BASE"] = "https://hpfx.collab.science.gc.ca";
  expect(fileUrl("TMP_ISBL-0850", "20260807", "12", 24)).toMatch(
    /^https:\/\/hpfx\.collab\.science\.gc\.ca\/20260807\/WXO-DD\/ensemble\/reps\//,
  );
});

it("every published level has a wind file token", () => {
  // 1000 hPa is its own four digits — the token is ISBL-1000, not ISBL-01000.
  expect(WIND_LEVEL_TOKENS["ISBL-1000"]).toBe(1000);
  expect(WIND_LEVEL_TOKENS["AGL-10m"]).toBeNull();
  expect(
    Object.keys(WIND_LEVEL_TOKENS)
      .filter((token) => token !== "AGL-10m")
      .sort(),
  ).toEqual(PRESSURE_LEVELS.map((level) => `ISBL-${String(level).padStart(4, "0")}`).sort());
});

it("the schedule starts after hour zero, which has no fluxes", () => {
  expect(FORECAST_HOURS[0]).toBe(STEP_HOURS);
  expect(FORECAST_HOURS).not.toContain(0);
  expect(FORECAST_HOURS[FORECAST_HOURS.length - 1]).toBe(72);
  expect(() => forecastHoursFromSteps("0")).toThrow(/0/);
});

it("explicit steps must be on the three-hourly schedule", () => {
  expect(forecastHoursFromSteps("24,18,21")).toEqual([18, 21, 24]);
  expect(() => forecastHoursFromSteps("17")).toThrow(/17/);
});

it("the fetch pool cap holds its documented value", () => {
  expect(FETCH_CONCURRENCY).toBe(5);
});

describe("all-members sampling", () => {
  it("scalar members are keyed by GRIB perturbationNumber", async () => {
    const members = await sampleScalarMembers(
      ensembleFile((member) => 100.0 + member),
      [SITE],
      "test field",
      noJ2k,
    );

    expect(
      Object.keys(members)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...PERTURBATION_NUMBERS]);
    expect(members[0]!["dundee"]).toBeCloseTo(100.0, 3); // perturbationNumber 0 = control
    expect(members[20]!["dundee"]).toBeCloseTo(120.0, 3);
  });

  it("a file missing a member fails loudly", async () => {
    const short = ensembleFile(() => 1.0, {
      members: PERTURBATION_NUMBERS.filter((member) => member !== 7),
    });

    await expect(sampleScalarMembers(short, [SITE], "test field", noJ2k)).rejects.toThrow(
      /expected 0–20/,
    );
  });

  it("a scalar file off the rotated grid fails loudly", async () => {
    await expect(
      sampleScalarMembers(ensembleMessage(0, 1.0, { rotated: false }), [SITE], "test field", noJ2k),
    ).rejects.toThrow(/rotated grid/);
  });

  it("wind members carry the rotation pole alongside the components", async () => {
    const members = await sampleWindMembers(
      ensembleFile((member) => 2.0 + member),
      [SITE],
      noJ2k,
    );

    expect(members[3]!.southPoleLatitude).toBeCloseTo(-90.0, 6);
    expect(members[3]!.southPoleLongitude).toBeCloseTo(0.0, 6);
    expect(members[3]!.values["dundee"]).toBeCloseTo(5.0, 3);
  });

  it("earth-relative wind components fail loudly", async () => {
    await expect(
      sampleWindMembers(
        ensembleFile(() => 1.0, { uvRelative: 0 }),
        [SITE],
        noJ2k,
      ),
    ).rejects.toThrow(/earth-relative/);
  });

  it("every member message decodes exactly once, fanned out concurrently", async () => {
    // The throughput rule under the pooled async path: an all-members
    // file issues one decode per member message — never one per site —
    // and all 21 go out CONCURRENTLY (the pool's fan-out), not one at a
    // time. The one-byte codestream carries the member number, so each
    // decoded value proves which message it came from.
    let decodes = 0;
    let inFlight = 0;
    let peakInFlight = 0;
    const decodeJ2k = async (codestream: Uint8Array): Promise<J2kSamples> => {
      decodes += 1;
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return {
        values: new Int32Array(9).fill(100 + codestream[0]!), // the member rides the codestream
        bitsPerSample: 8,
        isSigned: false,
        componentCount: 1,
      };
    };
    const erie = { slug: "erie", name: "Erie", latitude: 49.35, longitude: -117.25 };

    const members = await sampleScalarMembers(
      ensembleFile(() => 0.0, { jpeg2000: true }),
      [SITE, erie], // two sites, still one decode per message
      "test field",
      decodeJ2k,
    );

    expect(decodes).toBe(MEMBER_COUNT);
    expect(peakInFlight).toBe(MEMBER_COUNT); // all decodes issued before any settles
    expect(members[0]!["dundee"]).toBeCloseTo(100.0, 9);
    expect(members[7]!["dundee"]).toBeCloseTo(107.0, 9);
    expect(members[20]!["erie"]).toBeCloseTo(120.0, 9);
  });
});

function memberLevel(
  pressureHpa = 850,
  heightM = 1521.0,
  overrides: Record<string, number> = {},
): Record<string, number> {
  return {
    pressureHpa,
    heightM,
    temperatureC: 10.0,
    dewPointC: 2.0,
    windSpeedMps: 5.0,
    windDirectionDeg: 265.0,
    ...overrides,
  };
}

/** A member-profile hour; overrides land in the block that owns the key
 * (levels aside, keys are unambiguous between surface and derived). */
function memberHour(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const surface: Record<string, unknown> = {
    seaLevelPressureHpa: 1010.0,
    temperatureC: 20.0,
    dewPointC: 8.0,
    windSpeedMps: 10.0,
    windDirectionDeg: 265.0,
    cloudCoverPercent: 20.0,
    precipitationMmHr: 0.0,
    sensibleHeatFluxWm2: 300.0,
    latentHeatFluxWm2: 100.0,
  };
  const derived: Record<string, unknown> = {
    boundaryLayerTopM: 1500.0,
    thermalVelocityMps: 2.0,
    cloudBaseM: 2400.0,
    usableLiftTopM: null,
  };
  let levels: unknown = [
    memberLevel(),
    memberLevel(500, 5720.0, {
      temperatureC: -20.0,
      dewPointC: -38.0,
      windSpeedMps: 15.0,
      windDirectionDeg: 280.0,
    }),
  ];
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "levels") {
      levels = value;
    } else if (key in derived) {
      derived[key] = value;
    } else {
      surface[key] = value;
    }
  }
  return { validAt: "2026-08-07T21:00:00Z", surface, levels, derived };
}

function profiles(...hours: Array<Record<string, unknown>>): MemberProfile[] {
  return hours.map((hour) => ({ hours: [hour] })) as unknown as MemberProfile[];
}

interface Block {
  members: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  ceiledMembers?: number;
}

interface AggregatedHour {
  surface: Record<string, Block | number>;
  levels: Array<Record<string, Block | number>>;
  derived: Record<string, Block>;
}

function aggregateOne(...hours: Array<Record<string, unknown>>): AggregatedHour {
  const aggregated = aggregateHours(profiles(...hours));
  expect(aggregated).toHaveLength(1);
  return aggregated[0] as unknown as AggregatedHour;
}

describe("aggregation", () => {
  it("null members stay out of the ranking but are counted", () => {
    const hour = aggregateOne(
      memberHour({ usableLiftTopM: null }),
      memberHour({ usableLiftTopM: 2200.0 }),
    );

    expect(hour.derived["usableLiftTopM"]!.members).toBe(1);
    expect(hour.derived["usableLiftTopM"]!.p50).toBe(2200.0);
    expect(hour.derived["boundaryLayerTopM"]!.members).toBe(2);
  });

  it("all-null scalars publish null percentiles", () => {
    const hour = aggregateOne(
      memberHour({ boundaryLayerTopM: null, usableLiftTopM: null }),
      memberHour({ boundaryLayerTopM: null, usableLiftTopM: null }),
    );

    expect(hour.derived["boundaryLayerTopM"]).toEqual({
      ceiledMembers: 0,
      members: 0,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
    });
  });

  it("surface dew point joins the percentile scalars", () => {
    const hour = aggregateOne(memberHour({ dewPointC: 8.0 }), memberHour({ dewPointC: 10.0 }));

    expect(hour.surface["dewPointC"]).toMatchObject({ members: 2, p50: 9.0 });
    expect(SURFACE_SCALARS).toContain("dewPointC");
  });

  it("wind direction publishes the circular median, not a percentile block", () => {
    const hour = aggregateOne(
      memberHour({ windDirectionDeg: 350.0 }),
      memberHour({ windDirectionDeg: 10.0 }),
    );

    expect(hour.surface["windDirectionDeg"]).toBeCloseTo(0.0, 9);
    for (const level of hour.levels) {
      expect(typeof level["windDirectionDeg"]).toBe("number");
    }
  });
});

describe("ensemble sounding levels", () => {
  it("levels aggregate into percentile blocks per pressure", () => {
    const hour = aggregateOne(
      memberHour(),
      memberHour({
        levels: [
          memberLevel(850, 1541.0, { temperatureC: 12.0, windDirectionDeg: 275.0 }),
          memberLevel(500, 5740.0, { temperatureC: -18.0 }),
        ],
      }),
    );

    const [lower, upper] = hour.levels; // ascending height
    expect(lower!["pressureHpa"]).toBe(850);
    expect(upper!["pressureHpa"]).toBe(500);
    expect(lower!["heightM"]).toEqual({
      members: 2,
      p10: 1523.0,
      p25: 1526.0,
      p50: 1531.0,
      p75: 1536.0,
      p90: 1539.0,
    });
    expect((lower!["temperatureC"] as Block).p50).toBe(11.0);
    expect(lower!["windDirectionDeg"]).toBeCloseTo(270.0, 9);
    expect((upper!["temperatureC"] as Block).p50).toBe(-19.0);
  });

  it("a level below a member's terrain counts only the members that kept it", () => {
    // Member B's filtered column dropped 850 hPa (below its model surface);
    // the level still publishes, with the membership honest about it.
    const hour = aggregateOne(memberHour(), memberHour({ levels: [memberLevel(500, 5740.0)] }));

    const [lower, upper] = hour.levels;
    expect(lower!["pressureHpa"]).toBe(850);
    expect((lower!["heightM"] as Block).members).toBe(1);
    expect(upper!["pressureHpa"]).toBe(500);
    expect((upper!["heightM"] as Block).members).toBe(2);
  });

  it("a level no member kept is not published", () => {
    const hour = aggregateOne(
      memberHour({ levels: [memberLevel(500, 5720.0)] }),
      memberHour({ levels: [memberLevel(500, 5740.0)] }),
    );

    expect(hour.levels.map((level) => level["pressureHpa"])).toEqual([500]);
  });
});

describe("ceiling censoring", () => {
  it("fully ceiled hours count every member and keep percentiles", () => {
    // Both members clamped at the top of their own column — the percentiles
    // survive as lower bounds and ceiledMembers says they are censored.
    const hour = aggregateOne(
      memberHour({ boundaryLayerTopM: 5720.0 }),
      memberHour({ boundaryLayerTopM: 5740.0, levels: [memberLevel(500, 5740.0)] }),
    );

    expect(hour.derived["boundaryLayerTopM"]!.ceiledMembers).toBe(2);
    expect(hour.derived["boundaryLayerTopM"]!.members).toBe(2);
    expect(hour.derived["boundaryLayerTopM"]!.p50).toBe(5730.0);
  });

  it("partially ceiled hours count only the clamped members", () => {
    const hour = aggregateOne(
      memberHour({ usableLiftTopM: 5720.0 }), // at its column top
      memberHour({ usableLiftTopM: 3400.0 }), // measured below it
      memberHour({ usableLiftTopM: null }), // no lift: in neither count
    );

    expect(hour.derived["usableLiftTopM"]!.ceiledMembers).toBe(1);
    expect(hour.derived["usableLiftTopM"]!.members).toBe(2);
  });

  it("uncensored hours publish zero ceiled members", () => {
    const hour = aggregateOne(
      memberHour({ boundaryLayerTopM: 2100.0, usableLiftTopM: 2500.0 }),
      memberHour({ boundaryLayerTopM: 2300.0, usableLiftTopM: 2900.0 }),
    );

    expect(hour.derived["boundaryLayerTopM"]!.ceiledMembers).toBe(0);
    expect(hour.derived["usableLiftTopM"]!.ceiledMembers).toBe(0);
  });

  it("the ceiling check tolerates the float round trip", () => {
    const hour = aggregateOne(
      memberHour({ boundaryLayerTopM: 5720.0 - 0.4 }), // clamped, re-added
      memberHour({ boundaryLayerTopM: 5720.0 - 0.6 }), // genuinely below
    );

    expect(hour.derived["boundaryLayerTopM"]!.ceiledMembers).toBe(1);
  });

  it("only column-limited scalars carry a ceiled count", () => {
    const hour = aggregateOne(memberHour(), memberHour());

    expect(hour.derived["boundaryLayerTopM"]).toHaveProperty("ceiledMembers");
    expect(hour.derived["usableLiftTopM"]).toHaveProperty("ceiledMembers");
    expect(hour.derived["cloudBaseM"]).not.toHaveProperty("ceiledMembers");
    expect(hour.derived["thermalVelocityMps"]).not.toHaveProperty("ceiledMembers");
  });
});

it("a small document serializes deterministically", async () => {
  const { compactJson, roundDocument } = await import("../../src/publish.js");
  const hours = aggregateHours(
    profiles(
      memberHour({ levels: [memberLevel(500, 5720.0)] }),
      memberHour({
        boundaryLayerTopM: 2500.0,
        cloudBaseM: 2600.0,
        cloudCoverPercent: 40.0,
        dewPointC: 10.0,
        latentHeatFluxWm2: 200.0,
        levels: [
          memberLevel(500, 5740.0, {
            temperatureC: 12.0,
            dewPointC: 4.0,
            windSpeedMps: 7.0,
            windDirectionDeg: 275.0,
          }),
        ],
        precipitationMmHr: 1.0,
        seaLevelPressureHpa: 1020.0,
        sensibleHeatFluxWm2: 400.0,
        temperatureC: 22.0,
        thermalVelocityMps: 3.0,
        usableLiftTopM: 2200.0,
        windDirectionDeg: 275.0,
        windSpeedMps: 20.0,
      }),
    ),
  );
  const document = {
    schemaVersion: 1,
    model: "reps",
    run: {
      referenceTime: "2026-08-07T12:00:00Z",
      generatedAt: "2026-08-07T22:00:00Z",
      members: 21,
    },
    site: {
      id: "dundee",
      name: "Dundee",
      latitude: 49.291977,
      longitude: -117.183569,
      modelElevationM: 1200.0,
    },
    semantics: { precipitation: "windowMeanRate" },
    hours,
  };

  expect(compactJson(roundDocument(document))).toBe(
    '{"schemaVersion":1,"model":"reps",' +
      '"run":{"referenceTime":"2026-08-07T12:00:00Z","generatedAt":"2026-08-07T22:00:00Z",' +
      '"members":21},' +
      '"site":{"id":"dundee","name":"Dundee","latitude":49.291977,"longitude":-117.183569,' +
      '"modelElevationM":1200},' +
      '"semantics":{"precipitation":"windowMeanRate"},' +
      '"hours":[{"validAt":"2026-08-07T21:00:00Z",' +
      '"surface":{' +
      '"seaLevelPressureHpa":{"members":2,"p10":1011,"p25":1012.5,"p50":1015,"p75":1017.5,"p90":1019},' +
      '"temperatureC":{"members":2,"p10":20.2,"p25":20.5,"p50":21,"p75":21.5,"p90":21.8},' +
      '"dewPointC":{"members":2,"p10":8.2,"p25":8.5,"p50":9,"p75":9.5,"p90":9.8},' +
      '"windSpeedMps":{"members":2,"p10":11,"p25":12.5,"p50":15,"p75":17.5,"p90":19},' +
      '"windDirectionDeg":270,' +
      '"cloudCoverPercent":{"members":2,"p10":22,"p25":25,"p50":30,"p75":35,"p90":38},' +
      '"precipitationMmHr":{"members":2,"p10":0.1,"p25":0.25,"p50":0.5,"p75":0.75,"p90":0.9},' +
      '"sensibleHeatFluxWm2":{"members":2,"p10":310,"p25":325,"p50":350,"p75":375,"p90":390},' +
      '"latentHeatFluxWm2":{"members":2,"p10":110,"p25":125,"p50":150,"p75":175,"p90":190}},' +
      '"levels":[{"pressureHpa":500,' +
      '"heightM":{"members":2,"p10":5722,"p25":5725,"p50":5730,"p75":5735,"p90":5738},' +
      '"temperatureC":{"members":2,"p10":10.2,"p25":10.5,"p50":11,"p75":11.5,"p90":11.8},' +
      '"dewPointC":{"members":2,"p10":2.2,"p25":2.5,"p50":3,"p75":3.5,"p90":3.8},' +
      '"windSpeedMps":{"members":2,"p10":5.2,"p25":5.5,"p50":6,"p75":6.5,"p90":6.8},' +
      '"windDirectionDeg":270}],' +
      '"derived":{' +
      '"boundaryLayerTopM":{"ceiledMembers":0,"members":2,"p10":1600,"p25":1750,"p50":2000,"p75":2250,"p90":2400},' +
      '"thermalVelocityMps":{"members":2,"p10":2.1,"p25":2.25,"p50":2.5,"p75":2.75,"p90":2.9},' +
      '"cloudBaseM":{"members":2,"p10":2420,"p25":2450,"p50":2500,"p75":2550,"p90":2580},' +
      '"usableLiftTopM":{"ceiledMembers":0,"members":1,"p10":2200,"p25":2200,"p50":2200,"p75":2200,"p90":2200}}}]}',
  );
});

// One forecast step, one site, 35 synthetic all-members files served
// through a fake fetchBytes keyed by the exact URLs the builder must
// construct. Member m's values are linear in m, so every published
// percentile is the member at that exact rank.

const E2E_HEIGHTS: Record<number, number> = {
  1000: 150.0,
  925: 800.0,
  850: 1500.0,
  700: 3100.0,
  500: 5700.0,
};
const E2E_TEMPS_K: Record<number, number> = {
  1000: 292.65,
  925: 286.15,
  850: 279.15,
  700: 265.15,
  500: 242.15,
};
const E2E_SURFACE: Record<string, (m: number) => number> = {
  HGT_SFC: () => 100.0, // model terrain, PT000 only
  "TMP_AGL-2m": (m) => 293.15 + 0.1 * m,
  "RH_AGL-2m": () => 50.0,
  PRMSL_MSL: (m) => 101000.0 + 10.0 * m,
  TCDC_SFC: (m) => 20.0 + m,
  SHTFL_SFC: (m) => 300.0 + m,
  LHTFL_SFC: (m) => 100.0 + m,
  APCP_SFC: (m) => 3.0 + 0.3 * m, // run total; step delta ÷ 3 h → mm/h
  "UGRD_AGL-10m": (m) => 3.0 + 0.1 * m, // westerly: direction 270
  "VGRD_AGL-10m": () => 0.0,
};

function e2eMemberValue(variableLevel: string, member: number): number {
  const surface = E2E_SURFACE[variableLevel];
  if (surface !== undefined) {
    return surface(member);
  }
  const [variable, token] = variableLevel.split("_ISBL-") as [string, string];
  const level = Number.parseInt(token, 10);
  if (variable === "HGT") return E2E_HEIGHTS[level]! + member;
  if (variable === "TMP") return E2E_TEMPS_K[level]! + 0.1 * member;
  if (variable === "RH") return 50.0;
  if (variable === "UGRD") return 5.0 + 0.1 * member;
  if (variable === "VGRD") return 0.0;
  throw new Error(`unexpected field ${variableLevel}`);
}

function e2eFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set(fileUrl("HGT_SFC", "20260807", "00", 0), ensembleFile(E2E_SURFACE["HGT_SFC"]!));
  const hour3Fields = Object.keys(E2E_SURFACE).filter((name) => name !== "HGT_SFC");
  for (const level of PRESSURE_LEVELS) {
    for (const prefix of ["HGT", "TMP", "RH", "UGRD", "VGRD"]) {
      hour3Fields.push(`${prefix}_ISBL-${String(level).padStart(4, "0")}`);
    }
  }
  for (const name of hour3Fields) {
    files.set(
      fileUrl(name, "20260807", "00", 3),
      ensembleFile((member) => e2eMemberValue(name, member)),
    );
  }
  return files;
}

it("a forecast step flows from Datamart files to the ensemble document", async () => {
  const files = e2eFiles();
  const fetched: string[] = [];
  const fetchBytes = async (url: string): Promise<Uint8Array> => {
    fetched.push(url);
    const data = files.get(url);
    if (data === undefined) {
      throw new Error(`unscripted URL ${url}`); // a wrong URL fails loudly
    }
    return data;
  };

  const result = await buildDocuments(
    "2026-08-07T00:00:00Z",
    [{ forecastHour: 3, validAt: "2026-08-07T03:00:00Z" }],
    [SITE],
    new DownloadCounters(),
    { fetchBytes, decodeJ2k: noJ2k },
  );

  // Every file fetched exactly once; hour 000 — which has no flux or
  // precipitation files — is touched only for terrain.
  expect([...fetched].sort()).toEqual([...files.keys()].sort());
  expect(fetched.filter((url) => url.includes("PT000H"))).toEqual([
    fileUrl("HGT_SFC", "20260807", "00", 0),
  ]);

  expect(result.documents).toHaveLength(1);
  const document = result.documents[0]!;
  expect(document.site["modelElevationM"] as number).toBeCloseTo(100.0, 3);
  // The catalogue's timezone echo rides on the ensemble document too.
  expect(document.site["timeZone"]).toBe("America/Vancouver");
  // Ensemble envelope: the member count in run, the transport semantics
  // (no gust key — REPS publishes none) between site and hours.
  expect(document.run.members).toBe(21);
  expect(document.semantics).toEqual({ precipitation: "windowMeanRate" });
  expect(Object.keys(document)).toEqual([
    "schemaVersion",
    "model",
    "run",
    "site",
    "semantics",
    "hours",
  ]);
  expect(document.hours).toHaveLength(1);
  const hour = document.hours[0] as unknown as AggregatedHour;

  const surface = hour.surface;
  expect((surface["temperatureC"] as Block).members).toBe(21);
  expect((surface["temperatureC"] as Block).p50).toBeCloseTo(21.0, 3);
  expect((surface["dewPointC"] as Block).p50).toBeCloseTo(21.0 - dewPointDepression(21.0, 50.0), 3);
  expect((surface["seaLevelPressureHpa"] as Block).p50).toBeCloseTo(1011.0, 5);
  expect((surface["cloudCoverPercent"] as Block).p90).toBeCloseTo(38.0, 3);
  // mm/h: the 3 h run-total delta (baseline 0, hour 000 publishes no APCP)
  // divided by the window.
  expect((surface["precipitationMmHr"] as Block).p50).toBeCloseTo(2.0, 3);
  expect((surface["precipitationMmHr"] as Block).p10).toBeCloseTo(1.2, 3);
  expect((surface["windSpeedMps"] as Block).p50).toBeCloseTo(4.0, 3);
  expect(surface["windDirectionDeg"]).toBeCloseTo(270.0, 6);

  // The ensemble sounding: all five REPS pilot-band levels, ascending,
  // each field a percentile block across the 21 members, direction a
  // consensus.
  expect(hour.levels.map((level) => level["pressureHpa"])).toEqual([1000, 925, 850, 700, 500]);
  const level850 = hour.levels[2]!;
  expect((level850["heightM"] as Block).members).toBe(21);
  expect((level850["heightM"] as Block).p50).toBeCloseTo(1510.0, 3);
  expect((level850["temperatureC"] as Block).p50).toBeCloseTo(7.0, 3);
  expect((level850["dewPointC"] as Block).p50).toBeCloseTo(7.0 - dewPointDepression(7.0, 50.0), 3);
  expect((level850["windSpeedMps"] as Block).p50).toBeCloseTo(6.0, 3);
  expect(level850["windDirectionDeg"]).toBeCloseTo(270.0, 6);

  // Derivations ran per member, 21 atmospheres deep, before any ranking.
  expect(hour.derived["boundaryLayerTopM"]!.members).toBe(21);
  expect(hour.derived["thermalVelocityMps"]!.p50).not.toBeNull();
});

describe("buildReps", () => {
  let scratch: string | undefined;
  afterEach(() => {
    if (scratch !== undefined) {
      rmSync(scratch, { recursive: true, force: true });
      scratch = undefined;
    }
  });

  it("publishes the tree: rounded ensemble documents, history archive, manifest", async () => {
    scratch = mkdtempSync(join(tmpdir(), "reps-test-"));
    const sitesPath = join(scratch, "sites.json");
    writeFileSync(sitesPath, JSON.stringify({ schemaVersion: 2, sites: [SITE] }));
    const outputRoot = join(scratch, "data");
    const files = e2eFiles();
    // A pinned run skips the manifest gate; only the history seed reads
    // the dataset — 404, absence.
    const dataset = stubFetch([{ status: 404 }]);

    const built = await buildReps({
      sitesPath,
      outputRoot,
      referenceTime: "2026-08-07T00:00:00Z",
      maxSteps: 1,
      dataset: { fetch: dataset.fetch },
      fetchBytes: async (url) => {
        const data = files.get(url);
        if (data === undefined) throw new Error(`unscripted URL ${url}`);
        return data;
      },
      decodeJ2k: noJ2k,
      generatedAt: () => "2026-08-07T05:30:00Z",
      log: () => {},
    });

    expect(built).toBe(true);
    const document = JSON.parse(
      readFileSync(join(outputRoot, SLUG, "sites", "dundee.json"), "utf-8"),
    ) as {
      schemaVersion: number;
      model: string;
      run: { referenceTime: string; generatedAt: string; members: number };
      site: { id: string; modelElevationM: number; timeZone?: string };
      semantics: Record<string, string>;
      hours: unknown[];
    };
    expect(document.model).toBe(SLUG);
    expect(document.run).toEqual({
      referenceTime: "2026-08-07T00:00:00Z",
      generatedAt: "2026-08-07T05:30:00Z",
      members: 21,
    });
    expect(document.site.id).toBe("dundee");
    expect(document.site.modelElevationM).toBe(100.0);
    expect(document.site.timeZone).toBe("America/Vancouver");
    expect(document.semantics).toEqual(SEMANTICS);
    expect(document.hours).toHaveLength(1);

    const manifest = JSON.parse(
      readFileSync(join(outputRoot, SLUG, "manifest.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(manifest["firstForecastHour"]).toBe(3);
    expect(manifest["forecastHours"]).toBe(1);
    expect(manifest["lastForecastHour"]).toBe(3);
    expect(manifest["memberCount"]).toBe(21);
    expect(manifest["model"]).toBe(SLUG);
    expect(manifest["referenceTime"]).toBe("2026-08-07T00:00:00Z");
    expect(manifest["sites"]).toEqual([{ name: "Dundee", slug: "dundee" }]);

    // One run appended as one independent gzip member, one JSON line —
    // and the line IS the ensemble document.
    const archive = readFileSync(join(outputRoot, SLUG, "history", "dundee", "2026-08.jsonl.gz"));
    const members = splitMembers(archive);
    expect(members).toHaveLength(1);
    expect(members[0]!.lines).toHaveLength(1);
    expect(JSON.parse(members[0]!.lines[0]!)).toEqual(document);
  });

  it("history is the operator's choice: off writes no archives, on is byte-identical to the default", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "reps-test-"));
    scratch = tmp;
    const sitesPath = join(tmp, "sites.json");
    writeFileSync(sitesPath, JSON.stringify({ schemaVersion: 2, sites: [SITE] }));
    const files = e2eFiles();
    const build = async (root: string, history?: boolean) => {
      // A pinned run skips the manifest gate; only a history-publishing
      // run seeds the site's month (the single 404).
      const dataset = stubFetch(history === false ? [] : [{ status: 404 }]);
      const built = await buildReps({
        sitesPath,
        outputRoot: join(tmp, root),
        referenceTime: "2026-08-07T00:00:00Z",
        maxSteps: 1,
        dataset: { fetch: dataset.fetch },
        fetchBytes: async (url) => {
          const data = files.get(url);
          if (data === undefined) throw new Error(`unscripted URL ${url}`);
          return data;
        },
        decodeJ2k: noJ2k,
        generatedAt: () => "2026-08-07T05:30:00Z",
        log: () => {},
        ...(history !== undefined ? { history } : {}),
      });
      expect(built).toBe(true);
      return dataset;
    };

    await build("default");
    await build("on", true);
    const off = await build("off", false);

    // Off: no archive, no sidecar — and no seed read left the process.
    expect(existsSync(join(tmp, "off", SLUG, "history"))).toBe(false);
    expect(off.requests).toHaveLength(0);

    // The ensemble documents are identical across all three choices…
    const site = (root: string) => readFileSync(join(tmp, root, SLUG, "sites", "dundee.json"));
    expect(site("on").equals(site("default"))).toBe(true);
    expect(site("off").equals(site("default"))).toBe(true);

    // …explicit --history is byte-identical to the default…
    const history = (root: string, name: string) =>
      readFileSync(join(tmp, root, SLUG, "history", "dundee", name));
    expect(history("on", "2026-08.jsonl.gz").equals(history("default", "2026-08.jsonl.gz"))).toBe(
      true,
    );
    expect(
      history("on", "2026-08.index.json").equals(history("default", "2026-08.index.json")),
    ).toBe(true);

    // …and the manifest does not know the choice was made (stats and the
    // wall-clock stamp are the only fields that vary run to run).
    const manifest = (root: string) => {
      const parsed = JSON.parse(
        readFileSync(join(tmp, root, SLUG, "manifest.json"), "utf-8"),
      ) as Record<string, unknown>;
      delete parsed["stats"];
      delete parsed["generatedAt"];
      return parsed;
    };
    expect(manifest("off")).toEqual(manifest("default"));
    expect(manifest("on")).toEqual(manifest("default"));
  });
});
