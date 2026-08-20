import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecodeJ2k, J2kSamples } from "@azohra/meteo.grib";
import {
  FETCH_CONCURRENCY,
  GEPS,
  MEMBER_COUNT,
  PERTURBATION_NUMBERS,
  PRESSURE_LEVELS,
  SEMANTICS,
  aggregateHours,
  buildDocuments,
  buildGeps,
  requirePlausibleModelElevation,
  sampleScalarMembers,
  sampleWindMembers,
} from "../../src/builders/eccc-ensemble.js";
import { packagedModelsPath } from "../../src/catalogue.js";
import { circularMedian, percentile, type MemberProfile } from "../../src/ensemble.js";
import { dewPointDepression } from "../../src/moisture.js";
import { maskSentinel } from "../../src/sentinel.js";
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

/** Section 3: a 3×3 grid around Dundee — template 3.0 regular lat-lon
 * (GEPS's grid type) by default; template 3.1 rotated (REPS's) when
 * regular=false, for the wrong-grid guard. */
function gridSection(regular: boolean, uvRelative: number): number[] {
  const body = [
    0, // source: template-defined
    ...u32be(9), // numberOfDataPoints
    0, // no optional list
    0, // interpretation
    ...u16be(regular ? 0 : 1), // template
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
  if (!regular) {
    body.push(
      ...i32sm(Math.round(-25.6 * MICRO)),
      ...u32be(Math.round(269.6 * MICRO)),
      ...f32be(0.0),
    );
  }
  return section(3, body);
}

/** One member's message: PDT 4.1 (instantaneous ensemble) or 4.11
 * (ensemble over a run-origin interval — the accumulated fields' live
 * encoding), DRT 5.0 with bitsPerValue 0 (constant field = the float32
 * reference value). With jpeg2000, DRT 5.40 instead: the injected decode
 * seam must fire, and the one-byte section 7 payload (the perturbation
 * number) stands in for a codestream. */
function ensembleMessage(
  perturbation: number,
  value: number,
  {
    regular = true,
    uvRelative = 0,
    accumHours = null,
    jpeg2000 = false,
  }: {
    regular?: boolean;
    uvRelative?: number;
    accumHours?: number | null;
    jpeg2000?: boolean;
  } = {},
): Uint8Array {
  const section1 = section(1, [
    ...u16be(54), // centre: CMC
    ...u16be(0),
    28,
    0,
    1, // significance: start of forecast
    ...u16be(2026),
    8,
    7,
    0,
    0,
    0,
    0,
    4, // type: perturbed forecast
  ]);
  const templateBody = [
    ...u16be(0), // no coordinate values
    ...u16be(accumHours === null ? 1 : 11), // 4.1 instant / 4.11 interval
    0, // parameterCategory
    0, // parameterNumber
    4, // typeOfGeneratingProcess: ensemble
    0,
    0,
    ...u16be(0),
    0,
    1, // unit of time: hour
    ...u32be(accumHours === null ? 3 : 0), // forecastTime (interval start)
    1, // first fixed surface: ground
    0,
    ...u32be(0),
    255, // no second fixed surface
    255,
    ...u32be(0xffffffff),
    perturbation === 0 ? 1 : 4, // typeOfEnsembleForecast
    perturbation,
    MEMBER_COUNT,
  ];
  if (accumHours !== null) {
    // Template 4.11's time-interval block (octets 38-58): end of the
    // interval, one time range spec — accumulation over 0-accumHours.
    templateBody.push(
      ...u16be(2026),
      8,
      7 + Math.floor(accumHours / 24),
      accumHours % 24,
      0,
      0, // end of overall time interval
      1, // number of time range specifications
      ...u32be(0), // missing values in statistical process
      1, // statistical process: accumulation
      2, // type of time increment: same start
      1, // unit of the range: hour
      ...u32be(accumHours), // length of the range
      1, // unit of the increment
      ...u32be(0), // time increment
    );
  }
  const section4 = section(4, templateBody);
  const section5 = jpeg2000
    ? section(5, [
        ...u32be(9),
        ...u16be(40), // DRT 5.40: JPEG 2000
        ...f32be(0), // reference 0, scales 0: value = the raw sample
        ...u16be(0),
        ...u16be(0),
        8, // bitsPerValue nonzero: the codestream decoder must run
        0, // original field type: float
        0, // compression type: lossless
        255, // target compression ratio: missing
      ])
    : section(5, [
        ...u32be(9),
        ...u16be(0), // DRT 5.0
        ...f32be(value),
        ...u16be(0),
        ...u16be(0),
        0, // bitsPerValue 0: constant field
        0,
      ]);
  const sections = [
    ...section1,
    ...gridSection(regular, uvRelative),
    ...section4,
    ...section5,
    ...section(6, [255]),
    ...section(7, jpeg2000 ? [perturbation] : []),
  ];
  const total = 16 + sections.length + 4;
  return Uint8Array.from([
    0x47,
    0x52,
    0x49,
    0x42, // "GRIB"
    0,
    0,
    0, // discipline
    2, // edition
    ...u32be(0),
    ...u32be(total),
    ...sections,
    0x37,
    0x37,
    0x37,
    0x37, // "7777"
  ]);
}

function ensembleFile(
  valueForMember: (member: number) => number,
  {
    members = PERTURBATION_NUMBERS,
    uvRelative = 0,
    accumHours = null,
    jpeg2000 = false,
  }: {
    members?: readonly number[];
    uvRelative?: number;
    accumHours?: number | null;
    jpeg2000?: boolean;
  } = {},
): Uint8Array {
  const parts = members.map((member) =>
    ensembleMessage(member, valueForMember(member), { uvRelative, accumHours, jpeg2000 }),
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

it("the circular median crosses the wrap", () => {
  expect(circularMedian([350.0, 355.0, 5.0, 10.0, 15.0])).toBeCloseTo(5.0, 9);
  expect(circularMedian([80.0, 90.0, 100.0])).toBeCloseTo(90.0, 9);
});

it("Datamart URLs follow the old CMC naming scheme", () => {
  // GEPS raw never migrated to the new MSC filename scheme.
  expect(GEPS.fileUrl("CAPE_SFC_0", "20260808", "00", 24)).toBe(
    "https://dd.weather.gc.ca/20260808/WXO-DD/ensemble/geps/grib2/raw/00/024/" +
      "CMC_geps-raw_CAPE_SFC_0_latlon0p5x0p5_2026080800_P024_allmbrs.grib2",
  );
});

it("Datamart URLs honour the base override", () => {
  process.env["METEO_DATAMART_BASE"] = "https://hpfx.collab.science.gc.ca";
  expect(GEPS.fileUrl("CAPE_SFC_0", "20260808", "00", 24)).toMatch(
    /^https:\/\/hpfx\.collab\.science\.gc\.ca\/20260808\/WXO-DD\/ensemble\/geps\//,
  );
});

it("every published level has a wind file token", () => {
  expect(GEPS.windLevelTokens["ISBL_1000"]).toBe(1000);
  expect(GEPS.windLevelTokens["TGL_10m"]).toBeNull();
  expect(
    Object.keys(GEPS.windLevelTokens)
      .filter((token) => token !== "TGL_10m")
      .sort(),
  ).toEqual(PRESSURE_LEVELS.map((level) => `ISBL_${String(level).padStart(4, "0")}`).sort());
});

it("the schedule is three-hourly to 192 then six-hourly to 384", () => {
  expect(GEPS.forecastHours[0]).toBe(3); // hour 000 has no fluxes or precipitation
  expect(GEPS.forecastHours).not.toContain(0);
  expect(GEPS.forecastHours).toContain(192);
  expect(GEPS.forecastHours).not.toContain(195); // the 3-hourly cadence ends at 192
  expect(GEPS.forecastHours).toContain(198);
  expect(GEPS.forecastHours[GEPS.forecastHours.length - 1]).toBe(384);
  expect(GEPS.forecastHours).toHaveLength(96);
});

it("the accumulation window start follows the cadence change", () => {
  expect(GEPS.previousScheduledHour(24)).toBe(21);
  expect(GEPS.previousScheduledHour(192)).toBe(189);
  expect(GEPS.previousScheduledHour(198)).toBe(192); // 6-hourly window across the seam
  expect(GEPS.previousScheduledHour(384)).toBe(378);
});

it("the fetch pool cap holds its documented value", () => {
  expect(FETCH_CONCURRENCY).toBe(5);
});

// GEPS flags "convection not computed" with an exact -1 in CAPE; it does
// NOT use RDPS/GDPS's 9999 — real GEPS CAPE approaches 9999 J/kg. CIN has
// no sentinel at all.

it("the CAPE sentinel is minus one, masked to absence", () => {
  expect(maskSentinel(-1.0, GEPS.capeSentinel!)).toBeNull();
  // GRIB packing can smear the sentinel; the shared tolerance covers it.
  expect(maskSentinel(-0.7, GEPS.capeSentinel!)).toBeNull();
});

it("legitimate CAPE values survive the mask", () => {
  expect(maskSentinel(0.0, GEPS.capeSentinel!)).toBe(0.0); // zero CAPE is a measurement
  expect(maskSentinel(9399.0, GEPS.capeSentinel!)).toBe(9399.0); // observed member value
  expect(maskSentinel(9999.0, GEPS.capeSentinel!)).toBe(9999.0); // not a GEPS sentinel
});

describe("all-members sampling", () => {
  it("scalar members are keyed by GRIB perturbationNumber", async () => {
    const members = await sampleScalarMembers(
      GEPS,
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

    await expect(sampleScalarMembers(GEPS, short, [SITE], "test field", noJ2k)).rejects.toThrow(
      /expected 0–20/,
    );
  });

  it("a scalar file off the regular grid fails loudly", async () => {
    await expect(
      sampleScalarMembers(
        GEPS,
        ensembleMessage(0, 1.0, { regular: false }),
        [SITE],
        "test field",
        noJ2k,
      ),
    ).rejects.toThrow(/regular 0.5° grid/);
  });

  it("wind members sample without any rotation", async () => {
    const members = await sampleWindMembers(
      GEPS,
      ensembleFile((member) => 2.0 + member),
      [SITE],
      noJ2k,
    );

    expect(members[3]!.values["dundee"]).toBeCloseTo(5.0, 3);
  });

  it("grid-relative wind components fail loudly", async () => {
    // GEPS promises earth-relative components (uvRelativeToGrid=0); a grid
    // that starts rotating must not silently skew every bearing.
    await expect(
      sampleWindMembers(
        GEPS,
        ensembleFile(() => 1.0, { uvRelative: 1 }),
        [SITE],
        noJ2k,
      ),
    ).rejects.toThrow(/grid-relative/);
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
    const erie: Site = {
      slug: "erie",
      name: "Erie",
      latitude: 49.35,
      longitude: -117.25,
      timeZone: "America/Vancouver",
    };

    const members = await sampleScalarMembers(
      GEPS,
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

/** A member-profile hour; overrides land in the block that owns the key.
 * Passing capeJkg=null removes the key — the shape deriveSiteForecast
 * gives a sentinel-masked member. */
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
    capeJkg: 500.0,
    cinJkg: -25.0,
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
    } else if (key === "capeJkg" && value === null) {
      delete surface["capeJkg"];
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
  const aggregated = aggregateHours(GEPS, profiles(...hours));
  expect(aggregated).toHaveLength(1);
  return aggregated[0] as unknown as AggregatedHour;
}

describe("aggregation", () => {
  it("sentinel-masked members stay out of the CAPE ranking but are counted", () => {
    const hour = aggregateOne(
      memberHour({ capeJkg: null }), // sentinel-masked upstream
      memberHour({ capeJkg: 800.0 }),
    );

    expect((hour.surface["capeJkg"] as Block).members).toBe(1);
    expect((hour.surface["capeJkg"] as Block).p50).toBe(800.0);
    expect((hour.surface["cinJkg"] as Block).members).toBe(2); // CIN has no sentinel
    expect(GEPS.surfaceScalars).toContain("capeJkg");
    expect(GEPS.surfaceScalars).toContain("cinJkg");
  });

  it("an hour no member computed publishes null CAPE percentiles", () => {
    const hour = aggregateOne(memberHour({ capeJkg: null }), memberHour({ capeJkg: null }));

    expect(hour.surface["capeJkg"]).toEqual({
      members: 0,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
    });
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

  it("a level below a member's terrain counts only the members that kept it", () => {
    const hour = aggregateOne(memberHour(), memberHour({ levels: [memberLevel(500, 5740.0)] }));

    const [lower, upper] = hour.levels;
    expect(lower!["pressureHpa"]).toBe(850);
    expect((lower!["heightM"] as Block).members).toBe(1);
    expect(upper!["pressureHpa"]).toBe(500);
    expect((upper!["heightM"] as Block).members).toBe(2);
  });

  it("column-limited scalars carry a ceiled count", () => {
    const hour = aggregateOne(
      memberHour({ boundaryLayerTopM: 5720.0 }), // at its column top
      memberHour({ boundaryLayerTopM: 2100.0 }),
    );

    expect(hour.derived["boundaryLayerTopM"]!.ceiledMembers).toBe(1);
    expect(hour.derived["boundaryLayerTopM"]!.members).toBe(2);
    expect(hour.derived["cloudBaseM"]).not.toHaveProperty("ceiledMembers");
  });
});

it("a small document serializes deterministically", async () => {
  const { compactJson, roundDocument } = await import("../../src/publish.js");
  const hours = aggregateHours(
    GEPS,
    profiles(
      memberHour({ levels: [memberLevel(500, 5720.0)] }),
      memberHour({
        boundaryLayerTopM: 2500.0,
        capeJkg: 900.0,
        cinJkg: -5.0,
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
    model: "geps",
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
    '{"schemaVersion":1,"model":"geps",' +
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
      '"latentHeatFluxWm2":{"members":2,"p10":110,"p25":125,"p50":150,"p75":175,"p90":190},' +
      '"capeJkg":{"members":2,"p10":540,"p25":600,"p50":700,"p75":800,"p90":860},' +
      '"cinJkg":{"members":2,"p10":-23,"p25":-20,"p50":-15,"p75":-10,"p90":-7}},' +
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

// One forecast step, one site, 37 synthetic all-members files served
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
  // Model terrain, PT000 only, in DECAMETRES — the live file's encoding,
  // metadata notwithstanding — so the builder publishes 1450 m.
  HGT_SFC_0: () => 145.0,
  TMP_TGL_2m: (m) => 293.15 + 0.1 * m,
  RH_TGL_2m: () => 50.0,
  PRMSL_MSL_0: (m) => 101000.0 + 10.0 * m,
  TCDC_SFC_0: (m) => 20.0 + m,
  // Members 0–2 report the -1 "not computed" sentinel; 18 members rank.
  CAPE_SFC_0: (m) => (m < 3 ? -1.0 : 100.0 + 10.0 * m),
  // -1 J/kg is a legitimate weak cap in GEPS, never a sentinel.
  CIN_SFC_0: (m) => -1.0 - m,
  UGRD_TGL_10m: (m) => 3.0 + 0.1 * m, // westerly: direction 270
  VGRD_TGL_10m: () => 0.0,
};
// Run-origin accumulations at hour 3 (baseline 0 — hour 000 publishes
// none): SHTFL J/m² → 500 + 10·m W/m² over the 3 h window; APCP mm →
// 1 + 0.1·m mm/h.
const E2E_ACCUMULATED: Record<string, (m: number) => number> = {
  SHTFL_SFC_0: (m) => (500.0 + 10.0 * m) * 3 * 3600,
  LHTFL_SFC_0: (m) => (100.0 + m) * 3 * 3600,
  APCP_SFC_0: (m) => (1.0 + 0.1 * m) * 3,
};

function e2eMemberValue(variableLevel: string, member: number): number {
  const surface = E2E_SURFACE[variableLevel];
  if (surface !== undefined) return surface(member);
  const accumulated = E2E_ACCUMULATED[variableLevel];
  if (accumulated !== undefined) return accumulated(member);
  const [variable, token] = variableLevel.split("_ISBL_") as [string, string];
  const level = Number.parseInt(token, 10);
  if (variable === "HGT") return E2E_HEIGHTS[level]! + member;
  if (variable === "TMP") return E2E_TEMPS_K[level]! + 0.1 * member;
  if (variable === "RH") return 50.0;
  if (variable === "UGRD") return 5.0 + 0.1 * member;
  if (variable === "VGRD") return 0.0;
  throw new Error(`unexpected field ${variableLevel}`);
}

function e2eFile(name: string, forecastHour: number): Uint8Array {
  const accum = name in E2E_ACCUMULATED;
  return ensembleFile((member) => e2eMemberValue(name, member), {
    accumHours: accum ? forecastHour : null,
  });
}

function e2eHourFields(): string[] {
  const fields = Object.keys(E2E_SURFACE).filter((name) => name !== "HGT_SFC_0");
  fields.push(...Object.keys(E2E_ACCUMULATED));
  for (const level of PRESSURE_LEVELS) {
    for (const prefix of ["HGT", "TMP", "RH", "UGRD", "VGRD"]) {
      fields.push(`${prefix}_ISBL_${String(level).padStart(4, "0")}`);
    }
  }
  return fields;
}

function e2eFiles(
  terrain: (m: number) => number = E2E_SURFACE["HGT_SFC_0"]!,
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set(GEPS.fileUrl("HGT_SFC_0", "20260807", "00", 0), ensembleFile(terrain));
  // The model's own PT000 surface pressure, the barometric cross-check on
  // the terrain: 853 hPa implies ~1452 m.
  files.set(
    GEPS.fileUrl("PRES_SFC_0", "20260807", "00", 0),
    ensembleFile(() => 85300.0),
  );
  for (const name of e2eHourFields()) {
    files.set(GEPS.fileUrl(name, "20260807", "00", 3), e2eFile(name, 3));
  }
  return files;
}

function scriptedFetch(files: Map<string, Uint8Array>, fetched?: string[]) {
  return async (url: string): Promise<Uint8Array> => {
    fetched?.push(url);
    const data = files.get(url);
    if (data === undefined) {
      throw new Error(`unscripted URL ${url}`); // a wrong URL fails loudly
    }
    return data;
  };
}

it("a forecast step flows from Datamart files to the ensemble document", async () => {
  const files = e2eFiles();
  const fetched: string[] = [];

  const result = await buildDocuments(
    GEPS,
    "2026-08-07T00:00:00Z",
    [{ forecastHour: 3, validAt: "2026-08-07T03:00:00Z" }],
    [SITE],
    new DownloadCounters(),
    { fetchBytes: scriptedFetch(files, fetched), decodeJ2k: noJ2k },
  );

  // Every file fetched exactly once; hour 000 — which has no flux or
  // precipitation files — is touched only for terrain and the surface
  // pressure that cross-checks it.
  expect([...fetched].sort()).toEqual([...files.keys()].sort());
  expect(fetched.filter((url) => url.includes("_P000_")).sort()).toEqual(
    [
      GEPS.fileUrl("HGT_SFC_0", "20260807", "00", 0),
      GEPS.fileUrl("PRES_SFC_0", "20260807", "00", 0),
    ].sort(),
  );

  expect(result.documents).toHaveLength(1);
  const document = result.documents[0]!;
  // 145.0 decametres in the file → 1450 m published.
  expect(document.site["modelElevationM"] as number).toBeCloseTo(1450.0, 3);
  // The catalogue's timezone echo rides on the ensemble document.
  expect(document.site["timeZone"]).toBe("America/Vancouver");
  // Ensemble envelope: the member count in run, the transport semantics
  // (no gust key — GEPS publishes none) between site and hours.
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
  expect((surface["windSpeedMps"] as Block).p50).toBeCloseTo(4.0, 3);
  expect(surface["windDirectionDeg"]).toBeCloseTo(270.0, 6);

  // Run-origin accumulations, differenced over the first 3 h window
  // against a seeded zero baseline: W/m² and mm/h are linear in the
  // member.
  expect((surface["sensibleHeatFluxWm2"] as Block).members).toBe(21);
  expect((surface["sensibleHeatFluxWm2"] as Block).p50).toBeCloseTo(600.0, 5);
  expect((surface["latentHeatFluxWm2"] as Block).p50).toBeCloseTo(110.0, 5);
  expect((surface["precipitationMmHr"] as Block).p50).toBeCloseTo(2.0, 5);
  expect((surface["precipitationMmHr"] as Block).p10).toBeCloseTo(1.2, 5);

  // Three sentinel members stay out of the CAPE ranking (18 members
  // counted, percentiles over the defined 130–300 J/kg spread); CIN ranks
  // all 21, its exact -1 member included.
  const cape = surface["capeJkg"] as Block;
  expect(cape.members).toBe(18);
  expect(cape.p10).toBeCloseTo(147.0, 4);
  expect(cape.p50).toBeCloseTo(215.0, 4);
  expect(cape.p90).toBeCloseTo(283.0, 4);
  const cin = surface["cinJkg"] as Block;
  expect(cin.members).toBe(21);
  expect(cin.p50).toBeCloseTo(-11.0, 5);
  expect(cin.p90).toBeCloseTo(-3.0, 5);

  // The ensemble sounding: the levels above the model surface, ascending.
  // 1000 and 925 hPa sit below the 1450 m terrain — the live behaviour at
  // these mountain sites — and every member's filter drops them, so they
  // are not published at all.
  expect(hour.levels.map((level) => level["pressureHpa"])).toEqual([850, 700, 500]);
  const level850 = hour.levels[0]!;
  expect((level850["heightM"] as Block).members).toBe(21);
  expect((level850["heightM"] as Block).p50).toBeCloseTo(1510.0, 3);
  expect((level850["temperatureC"] as Block).p50).toBeCloseTo(7.0, 3);
  expect((level850["windSpeedMps"] as Block).p50).toBeCloseTo(6.0, 3);
  expect(level850["windDirectionDeg"]).toBeCloseTo(270.0, 6);

  expect(hour.derived["boundaryLayerTopM"]!.members).toBe(21);
  expect(hour.derived["thermalVelocityMps"]!.p50).not.toBeNull();
});

it("a six-hourly tail step differences accumulations across its own window", async () => {
  // Hour 198 is the first 6-hourly step; its accumulation window starts
  // at 192 — the previous *scheduled* hour, not 195 — and the deltas
  // divide by six hours, not three.
  const baseline: Record<string, (m: number) => number> = {
    SHTFL_SFC_0: () => 1.0e6,
    LHTFL_SFC_0: () => 2.0e6,
    APCP_SFC_0: () => 5.0,
  };
  const files = new Map<string, Uint8Array>();
  files.set(
    GEPS.fileUrl("HGT_SFC_0", "20260807", "00", 0),
    ensembleFile(E2E_SURFACE["HGT_SFC_0"]!),
  );
  files.set(
    GEPS.fileUrl("PRES_SFC_0", "20260807", "00", 0),
    ensembleFile(() => 85300.0),
  );
  for (const [name, accumulated] of Object.entries(baseline)) {
    files.set(
      GEPS.fileUrl(name, "20260807", "00", 192),
      ensembleFile(accumulated, { accumHours: 192 }),
    );
  }
  for (const name of e2eHourFields()) {
    const inBaseline = baseline[name];
    const content =
      inBaseline !== undefined
        ? ensembleFile(
            (m) =>
              inBaseline(m) +
              (name === "APCP_SFC_0"
                ? (0.5 + 0.1 * m) * 6 // → 0.5 + 0.1·m mm/h
                : (10.0 + m) * 6 * 3600), // → mean 10 + m W/m²
            { accumHours: 198 },
          )
        : e2eFile(name, 198);
    files.set(GEPS.fileUrl(name, "20260807", "00", 198), content);
  }
  const fetched: string[] = [];

  const result = await buildDocuments(
    GEPS,
    "2026-08-07T00:00:00Z",
    [{ forecastHour: 198, validAt: "2026-08-15T06:00:00Z" }],
    [SITE],
    new DownloadCounters(),
    { fetchBytes: scriptedFetch(files, fetched), decodeJ2k: noJ2k },
  );

  expect([...fetched].sort()).toEqual([...files.keys()].sort()); // exactly the window ends, once each

  const hour = result.documents[0]!.hours[0] as unknown as AggregatedHour;
  expect((hour.surface["sensibleHeatFluxWm2"] as Block).p50).toBeCloseTo(20.0, 4);
  expect((hour.surface["latentHeatFluxWm2"] as Block).p50).toBeCloseTo(20.0, 4);
  expect((hour.surface["precipitationMmHr"] as Block).p50).toBeCloseTo(1.5, 5);
});

// The live HGT_SFC file is encoded in decametres while its GRIB metadata
// claims metres. The builder scales the field to metres and holds the
// datum to the model's own PT000 surface pressure via p = p0·exp(−z/H):
// a correctly scaled field puts the implied elevation well under the
// 1,000 m tolerance, a dropped ×10 leaves a ≥1.3 km gap, a gained ×10 a
// ~13 km one.

// The live control-member surface pressure at Dundee: 845.9 hPa.
const DUNDEE_PRESSURE = { 0: { dundee: 84586.0 } };

it("surface orography decametres publish as metres", async () => {
  expect(GEPS.terrainToM).toBe(10.0);
  // 153.6 is a live control-member decametre reading at Dundee; the
  // pre-fix builder published it verbatim as 153.6 m.
  const files = e2eFiles(() => 153.6);

  const result = await buildDocuments(
    GEPS,
    "2026-08-07T00:00:00Z",
    [{ forecastHour: 3, validAt: "2026-08-07T03:00:00Z" }],
    [SITE],
    new DownloadCounters(),
    { fetchBytes: scriptedFetch(files), decodeJ2k: noJ2k },
  );

  expect(result.documents[0]!.site["modelElevationM"] as number).toBeCloseTo(1536.0, 2);
});

it("the guard accepts plausible terrain", () => {
  // The live pair after the decametre fix: 1536 m smoothed terrain
  // against 845.9 hPa — the barometric relation puts the surface ~13 m
  // away.
  requirePlausibleModelElevation({ 0: { dundee: 1536.0 } }, DUNDEE_PRESSURE, [SITE]);
});

it("the guard accepts sea level", () => {
  requirePlausibleModelElevation({ 0: { dundee: 2.0 } }, { 0: { dundee: 101325.0 } }, [SITE]);
});

it("honest pressure extremes never trip the guard", () => {
  // ±40 hPa is a deep low or a strong high — real weather, not an
  // encoding change; the implied elevation moves ~±400 m, well inside the
  // 1,000 m tolerance.
  for (const [elevation, pressurePa] of [
    [2.0, 97325.0], // deep sea-level low
    [2.0, 105325.0], // strong sea-level high
    [1536.0, 80586.0], // the same ±40 hPa swings at the mountain site
    [1536.0, 88586.0],
  ] as const) {
    requirePlausibleModelElevation({ 0: { dundee: elevation } }, { 0: { dundee: pressurePa } }, [
      SITE,
    ]);
  }
});

it("a ten-times datum is barometrically impossible", () => {
  // A genuine-metre re-encode under the ×10 scaling: a ~15 km datum while
  // the model's own surface pressure sits at 845.9 hPa (~1.5 km) — the
  // failure names both numbers.
  expect(() =>
    requirePlausibleModelElevation({ 0: { dundee: 15360.0 } }, DUNDEE_PRESSURE, [SITE]),
  ).toThrow(/15360\.0 m[\s\S]*845\.9 hPa/);
});

it("a tenth-scale datum is barometrically impossible", () => {
  // The v1 decametre bug's shape — raw decametres published as metres: a
  // 153.6 m datum against 845.9 hPa (~1.5 km implied) is exactly what the
  // deleted catalogued-elevation bound used to catch.
  expect(() =>
    requirePlausibleModelElevation({ 0: { dundee: 153.6 } }, DUNDEE_PRESSURE, [SITE]),
  ).toThrow(/153\.6 m[\s\S]*845\.9 hPa/);
});

it("a datum above any Earth terrain fails loudly", () => {
  // The ceiling backstop: a 9.5 km datum with barometrically consistent
  // pressure is still refused — nothing on Earth is that high.
  expect(() =>
    requirePlausibleModelElevation({ 0: { dundee: 9500.0 } }, { 0: { dundee: 32845.0 } }, [SITE]),
  ).toThrow(/higher than any Earth terrain/);
});

const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
  models: Array<{
    slug: string;
    kind?: string;
    stepHours: number;
    horizonHours: number;
    runIntervalHours: number;
    capabilities: Record<string, unknown>;
  }>;
};

it("models.json matches the builder configuration", () => {
  const entry = catalogue.models.find((model) => model.slug === GEPS.slug)!;
  expect(entry.kind).toBe("ensemble");
  expect(entry.stepHours).toBe(GEPS.forecastHours[0]);
  expect(entry.horizonHours).toBe(GEPS.lastForecastHour);
  expect(entry.runIntervalHours).toBe(24 / GEPS.runHours.length);
  const capabilities = entry.capabilities;
  const published = GEPS.surfaceScalars as readonly string[];
  expect(capabilities["levels"]).toBe(true);
  expect(capabilities["pressureLevels"]).toEqual([...PRESSURE_LEVELS]);
  // The aggregate publishes CAPE and CIN exactly when the catalogue says so.
  expect(capabilities["cape"]).toBe(published.includes("capeJkg"));
  expect(capabilities["cin"]).toBe(published.includes("cinJkg"));
  expect(capabilities["heatFluxes"]).toBe(
    published.includes("sensibleHeatFluxWm2") && published.includes("latentHeatFluxWm2"),
  );
  // The GEPS feed publishes no gust, omega, PBL, cloud structure, or smoke.
  expect(capabilities["gust"]).toBe(false);
  expect(capabilities["verticalVelocity"]).toBe(false);
  expect(capabilities["pblHeight"]).toBe(false);
  expect(capabilities["cloudLayers"]).toBe(false);
  expect(capabilities["cloudProfile"]).toBe(false);
  expect(capabilities["smoke"]).toBe(false);
  // The transport semantics mirror the catalogue's precipitation token.
  expect(capabilities["precipitation"]).toBe(SEMANTICS.precipitation);
});

it("skips a pinned run the dataset already publishes", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "geps-test-"));
  try {
    const sitesPath = join(scratch, "sites.json");
    writeFileSync(sitesPath, JSON.stringify({ schemaVersion: 2, sites: [SITE] }));
    const manifest = { model: GEPS.slug, referenceTime: "2026-08-07T00:00:00Z" };
    const dataset = stubFetch([{ status: 200, body: JSON.stringify(manifest) }]);
    const lines: string[] = [];

    const built = await buildGeps({
      sitesPath,
      outputRoot: join(scratch, "data"),
      referenceTime: "2026-08-07T00:00:00Z",
      dataset: { fetch: dataset.fetch },
      fetchBytes: async (url) => {
        throw new Error(`unscripted URL ${url}`);
      },
      log: (line) => lines.push(line),
    });

    expect(built).toBe(false);
    expect(lines).toEqual(["GEPS run 2026-08-07T00:00:00Z is already published."]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
