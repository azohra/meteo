import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MissingRecordError,
  findRecord,
  lambertEarthWind,
  lambertGridRotationDeg,
  pairSpan,
  parseIdx,
  type IdxRecord,
} from "@azohra/meteo.grib";
import {
  CLOUD_LAYER_FIELDS,
  FETCH_CONCURRENCY,
  OMEGA_LEVELS,
  OPTIONAL_SURFACE_FIELDS,
  PRESSURE_LEVELS,
  PRODUCTS,
  SEMANTICS,
  buildProfiles,
  completionUrls,
  fileUrl,
  precipFetches,
  type NamWire,
} from "../../src/builders/nam.js";
import { packagedModelsPath } from "../../src/catalogue.js";
import { windFromUv, type GridPointValue, type SampleSite } from "../../src/providers/noaa.js";
import { DownloadCounters } from "../../src/providers/transport.js";
import { useCleanWireEnv } from "../helpers/wire.js";

useCleanWireEnv();

const NEST = PRODUCTS["nam-conus-nest"]!;
const PARENT = PRODUCTS["nam"]!;

const fixtureIdx = (name: string): IdxRecord[] =>
  parseIdx(
    readFileSync(
      fileURLToPath(new URL(`../../../grib/test/fixtures-idx/${name}`, import.meta.url)),
      "utf-8",
    ),
  );

const nestRecords = () => fixtureIdx("nam.t12z.conusnest.hiresf24.tm00.excerpt.idx");
const parentRecords = () => fixtureIdx("nam.t12z.awphys24.tm00.excerpt.idx");

describe("the published schedules", () => {
  it("the nest is hourly to 60, skipping the analysis", () => {
    expect(NEST.forecastHours).toEqual(Array.from({ length: 60 }, (_hour, index) => index + 1));
  });

  it("the parent is hourly to 36 then three-hourly to 84", () => {
    expect(PARENT.forecastHours.slice(0, 36)).toEqual(
      Array.from({ length: 36 }, (_hour, index) => index + 1),
    );
    expect(PARENT.forecastHours.slice(36)).toEqual(
      Array.from({ length: 16 }, (_hour, index) => 39 + index * 3),
    );
    expect(PARENT.forecastHours[PARENT.forecastHours.length - 1]).toBe(84);
  });

  it("completeness gates on the final hour of every needed file", () => {
    // The parent needs the awip12 cloud companion through the horizon too;
    // the nest's clouds live in its own file.
    const bucket = "https://noaa-nam-pds.s3.amazonaws.com/nam.20260807";
    expect(completionUrls(PARENT, "20260807", "12")).toEqual([
      `${bucket}/nam.t12z.awphys84.tm00.grib2.idx`,
      `${bucket}/nam.t12z.awip1284.tm00.grib2.idx`,
    ]);
    expect(completionUrls(NEST, "20260807", "06")).toEqual([
      `${bucket}/nam.t06z.conusnest.hiresf60.tm00.grib2.idx`,
    ]);
  });
});

describe.each(["00", "06", "12", "18"])(
  "nest precipitation differences three-hour buckets on the %sZ cycle",
  (runHour) => {
    it.each<[number, Array<[number, string]>, number]>([
      // Right after a 3 h bucket reset the record is the step itself.
      [1, [[1, "0-1 hour acc fcst"]], 1],
      [4, [[4, "3-4 hour acc fcst"]], 1],
      [22, [[22, "21-22 hour acc fcst"]], 1],
      // Inside the bucket, difference consecutive running records.
      [
        2,
        [
          [2, "0-2 hour acc fcst"],
          [1, "0-1 hour acc fcst"],
        ],
        1,
      ],
      [
        24,
        [
          [24, "21-24 hour acc fcst"],
          [23, "21-23 hour acc fcst"],
        ],
        1,
      ],
      [
        60,
        [
          [60, "57-60 hour acc fcst"],
          [59, "57-59 hour acc fcst"],
        ],
        1,
      ],
    ])("f%d", (forecastHour, fetches, windowHours) => {
      expect(precipFetches(NEST, runHour, forecastHour)).toEqual([fetches, windowHours]);
    });
  },
);

describe.each(["00", "12"])(
  "parent precipitation differences twelve-hour buckets on the %sZ synoptic cycle",
  (runHour) => {
    it.each<[number, Array<[number, string]>, number]>([
      // 12 h buckets over the hourly phase.
      [1, [[1, "0-1 hour acc fcst"]], 1],
      [
        12,
        [
          [12, "0-12 hour acc fcst"],
          [11, "0-11 hour acc fcst"],
        ],
        1,
      ],
      [13, [[13, "12-13 hour acc fcst"]], 1],
      [
        24,
        [
          [24, "12-24 hour acc fcst"],
          [23, "12-23 hour acc fcst"],
        ],
        1,
      ],
      [
        36,
        [
          [36, "24-36 hour acc fcst"],
          [35, "24-35 hour acc fcst"],
        ],
        1,
      ],
      // The 3-hourly tail publishes a direct (h−3)–h record — no
      // differencing, divided by 3 for mm/h. At f39 that record is the
      // running bucket "36-39", which IS the 3 h step.
      [39, [[39, "36-39 hour acc fcst"]], 3],
      [42, [[42, "39-42 hour acc fcst"]], 3],
      [84, [[84, "81-84 hour acc fcst"]], 3],
    ])("f%d", (forecastHour, fetches, windowHours) => {
      expect(precipFetches(PARENT, runHour, forecastHour)).toEqual([fetches, windowHours]);
    });
  },
);

describe.each(["06", "18"])(
  "parent precipitation differences three-hour buckets on the off-cycle %sZ run",
  (runHour) => {
    it.each<[number, Array<[number, string]>, number]>([
      // On 06/18Z the parent's buckets reset every 3 h like the nest.
      [1, [[1, "0-1 hour acc fcst"]], 1],
      [4, [[4, "3-4 hour acc fcst"]], 1],
      [13, [[13, "12-13 hour acc fcst"]], 1],
      [
        24,
        [
          [24, "21-24 hour acc fcst"],
          [23, "21-23 hour acc fcst"],
        ],
        1,
      ],
      [
        36,
        [
          [36, "33-36 hour acc fcst"],
          [35, "33-35 hour acc fcst"],
        ],
        1,
      ],
      // The 3-hourly tail is cycle-independent.
      [39, [[39, "36-39 hour acc fcst"]], 3],
      [84, [[84, "81-84 hour acc fcst"]], 3],
    ])("f%d", (forecastHour, fetches, windowHours) => {
      expect(precipFetches(PARENT, runHour, forecastHour)).toEqual([fetches, windowHours]);
    });
  },
);

it("boundary hours carry two APCP records and selection is by window", () => {
  // At f24 of a 00/12Z run the parent file holds "12-24" (running bucket)
  // beside "21-24" (3 h sub-bucket). The builder must land on the exact
  // window it asks for — first-match-by-variable would be wrong half the
  // time.
  const records = parentRecords();
  const running = findRecord(records, "APCP", "surface", "12-24 hour acc fcst");
  const subBucket = findRecord(records, "APCP", "surface", "21-24 hour acc fcst");
  expect(running.offset).not.toBe(subBucket.offset);
  const [fetches] = precipFetches(PARENT, "12", 24);
  expect(fetches[0]).toEqual([24, "12-24 hour acc fcst"]);
});

it("the tail record exists and the running bucket sits beside it", () => {
  const records = fixtureIdx("nam.t12z.awphys42.tm00.excerpt.idx");
  const direct = findRecord(records, "APCP", "surface", "39-42 hour acc fcst");
  const running = findRecord(records, "APCP", "surface", "36-42 hour acc fcst");
  expect(direct.offset).not.toBe(running.offset);
});

describe("the per-product Lambert rotations", () => {
  it("applies no rotation on each product's own orientation meridian", () => {
    expect(lambertGridRotationDeg(262.5, NEST.lambertOrientationDeg, NEST.lambertCone)).toBe(0);
    expect(lambertGridRotationDeg(265.0, PARENT.lambertOrientationDeg, PARENT.lambertCone)).toBe(0);
  });

  it("nest rotation matches HRRR and the parent differs", () => {
    // The nest shares HRRR's projection: sin(38.5°) × (242.3 − 262.5) ≈ −12.6°.
    // The parent's cone is sin(25°) about LoV 265°: sin(25°) × (242.3 − 265) ≈ −9.6°.
    const nest = lambertGridRotationDeg(242.3, NEST.lambertOrientationDeg, NEST.lambertCone);
    const parent = lambertGridRotationDeg(242.3, PARENT.lambertOrientationDeg, PARENT.lambertCone);
    expect(nest).toBeCloseTo(-12.575, 3);
    expect(parent).toBeCloseTo(-9.593, 3);
  });

  it("preserves speed and shifts direction by the local angle", () => {
    const [uEarth, vEarth] = lambertEarthWind(
      0.0,
      10.0,
      242.3,
      PARENT.lambertOrientationDeg,
      PARENT.lambertCone,
    );
    const [speed, direction] = windFromUv(uEarth, vEarth);
    expect(speed).toBeCloseTo(10.0, 9);
    expect(direction).toBeCloseTo(
      180 + lambertGridRotationDeg(242.3, PARENT.lambertOrientationDeg, PARENT.lambertCone),
      9,
    );
  });

  it("the rotation matrix is orthogonal for an arbitrary wind", () => {
    const [uEarth, vEarth] = lambertEarthWind(
      -7.3,
      2.1,
      250.0,
      NEST.lambertOrientationDeg,
      NEST.lambertCone,
    );
    expect(Math.hypot(uEarth, vEarth)).toBeCloseTo(Math.hypot(-7.3, 2.1), 9);
  });
});

describe("the paired U/V idx span arithmetic", () => {
  it("paired wind idx lines share an offset and one spans the message", () => {
    // NCEP packs UGRD/VGRD as two submessages of one message; the idx lists
    // them as N.1/N.2 at the same offset, so parseIdx gives the first a
    // zero length and the second the span to the next record (ABSV here).
    const records = nestRecords();
    const u = findRecord(records, "UGRD", "850 mb", "24 hour fcst");
    const v = findRecord(records, "VGRD", "850 mb", "24 hour fcst");
    const absv = findRecord(records, "ABSV", "850 mb", "24 hour fcst");
    expect(u.offset).toBe(v.offset);
    expect(u.length).toBe(0);
    expect(v.length).toBe(absv.offset - v.offset);

    const span = pairSpan(u, v);
    expect(span.offset).toBe(u.offset);
    expect(span.length).toBe(absv.offset - u.offset);
  });

  it("pairSpan handles an end-of-file pair", () => {
    const u: IdxRecord = {
      variable: "UGRD",
      level: "10 m above ground",
      forecast: "24 hour fcst",
      offset: 100,
      length: 0,
    };
    const v: IdxRecord = {
      variable: "VGRD",
      level: "10 m above ground",
      forecast: "24 hour fcst",
      offset: 100,
      length: undefined,
    };
    expect(pairSpan(u, v)).toBe(v);
    expect(pairSpan(v, u)).toBe(v);
  });
});

describe("the .idx record inventory", () => {
  it("every surface and science record exists in both products", () => {
    for (const records of [nestRecords(), parentRecords()]) {
      findRecord(records, "PRMSL", "mean sea level", "24 hour fcst");
      findRecord(
        records,
        "TCDC",
        "entire atmosphere (considered as a single layer)",
        "24 hour fcst",
      );
      findRecord(records, "HGT", "surface", "24 hour fcst");
      findRecord(records, "TMP", "2 m above ground", "24 hour fcst");
      findRecord(records, "DPT", "2 m above ground", "24 hour fcst");
      for (const [variable, level] of Object.values(OPTIONAL_SURFACE_FIELDS)) {
        findRecord(records, variable, level, "24 hour fcst");
      }
    }
  });

  it("flux records resolve to the instantaneous flavour", () => {
    // The nest publishes averaged twins ("21-24 hour ave fcst") beside the
    // instantaneous records; the builder's exact forecast token must land
    // on the instant ones.
    const records = nestRecords();
    for (const variable of ["SHTFL", "LHTFL"]) {
      const record = findRecord(records, variable, "surface", "24 hour fcst");
      expect(record.forecast).toBe("24 hour fcst");
      findRecord(records, variable, "surface", "21-24 hour ave fcst"); // the twin exists
    }
  });

  it("layered cloud is in-file for the nest but only in awip12 for the parent", () => {
    const nest = nestRecords();
    const parent = parentRecords();
    const awip12 = fixtureIdx("nam.t12z.awip1224.tm00.excerpt.idx");
    for (const [variable, level] of Object.values(CLOUD_LAYER_FIELDS)) {
      findRecord(nest, variable, level, "24 hour fcst");
      findRecord(awip12, variable, level, "24 hour fcst");
      expect(() => findRecord(parent, variable, level, "24 hour fcst")).toThrow(MissingRecordError);
    }
    expect(NEST.cloudFileToken).toBeNull();
    expect(PARENT.cloudFileToken).toBe("awip12");
  });

  it("level moisture comes from RH because level dewpoint is incomplete", () => {
    // awphys has no level DPT at all; the nest has it only at 925/850/700.
    // RH is present at all nine curated levels on both.
    const parent = parentRecords();
    const nest = nestRecords();
    for (const pressureHpa of PRESSURE_LEVELS) {
      findRecord(parent, "RH", `${pressureHpa} mb`, "24 hour fcst");
      findRecord(nest, "RH", `${pressureHpa} mb`, "24 hour fcst");
    }
    expect(() => findRecord(parent, "DPT", "600 mb", "24 hour fcst")).toThrow(MissingRecordError);
  });

  it("omega exists at every curated level in both products", () => {
    const parent = parentRecords();
    const nest = nestRecords();
    expect(OMEGA_LEVELS).toBe(PRESSURE_LEVELS);
    for (const pressureHpa of OMEGA_LEVELS) {
      findRecord(parent, "VVEL", `${pressureHpa} mb`, "24 hour fcst");
      findRecord(nest, "VVEL", `${pressureHpa} mb`, "24 hour fcst");
    }
  });

  it("missing records raise the tolerable error type", () => {
    expect(() => findRecord(parentRecords(), "GUST", "surface", "25 hour fcst")).toThrow(
      MissingRecordError,
    );
    expect(new MissingRecordError("x")).toBeInstanceOf(Error);
  });
});

describe.each(["nam", "nam-conus-nest"])("models.json matches the %s configuration", (slug) => {
  it("declares the builder's capabilities", () => {
    const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
      models: Array<{
        slug: string;
        horizonHours: number;
        sunset: Record<string, string>;
        capabilities: Record<string, unknown>;
      }>;
    };
    const entry = catalogue.models.find((model) => model.slug === slug)!;
    const product = PRODUCTS[slug]!;

    expect(entry.horizonHours).toBe(product.forecastHours[product.forecastHours.length - 1]);
    expect(entry.sunset).toEqual({ date: "2026-10-06", successor: "rrfs" });

    const capabilities = entry.capabilities;
    expect(capabilities["gust"]).toBe("instant"); // NOAA has no hour-max gust
    // Bucketed APCP differenced per step ÷ window → a window-mean rate, and
    // the documents' own semantics block says the same for both products.
    expect(capabilities["precipitation"]).toBe("windowMeanRate");
    expect(SEMANTICS).toEqual({ gust: "instant", precipitation: "windowMeanRate" });
    expect(capabilities["cape"]).toBe(true);
    expect(capabilities["cin"]).toBe(true);
    expect(capabilities["pblHeight"]).toBe(true);
    expect(capabilities["cloudLayers"]).toBe(true); // via awip12 for the parent
    expect(capabilities["cloudProfile"]).toBe(false); // no per-level TCDC
    expect(capabilities["pressureLevels"]).toEqual([...PRESSURE_LEVELS]);
    expect(capabilities["verticalVelocity"]).toBe("omega");
    expect(capabilities["verticalVelocityLevels"]).toEqual([...OMEGA_LEVELS]);
    const optional = Object.keys(OPTIONAL_SURFACE_FIELDS);
    for (const field of ["windGustMps", "capeJkg", "cinJkg", "pblHeightM"]) {
      expect(optional).toContain(field);
    }
  });
});

it("the fetch pool cap holds its catalogued value and URLs match the bucket grammar", () => {
  expect(FETCH_CONCURRENCY).toBe(14);
  expect(NEST.maxNearestKm).toBe(5.0);
  expect(PARENT.maxNearestKm).toBe(15.0);
  expect(fileUrl("awphys", "20260807", "12", 6)).toBe(
    "https://noaa-nam-pds.s3.amazonaws.com/nam.20260807/nam.t12z.awphys06.tm00.grib2",
  );
  expect(fileUrl("conusnest.hiresf", "20260807", "00", 60)).toBe(
    "https://noaa-nam-pds.s3.amazonaws.com/nam.20260807/nam.t00z.conusnest.hiresf60.tm00.grib2",
  );
});

// buildProfiles with the wire faked at the .idx/record/sampling seam —
// the paired-wind fetch (shared offset → sampleSitesUv), the running-
// bucket precip differencing, and the awip12 cloud companion routing. ---

const SITE: SampleSite & { timeZone: string } = {
  slug: "boulder",
  name: "Boulder",
  latitude: 40.0,
  longitude: 255.0,
  timeZone: "America/Denver",
};
const LEVEL_HEIGHTS: Record<number, number> = {
  925: 800.0,
  900: 1000.0,
  875: 1250.0,
  850: 1500.0,
  800: 2000.0,
  750: 2500.0,
  700: 3000.0,
  650: 3500.0,
  600: 4000.0,
};
const OMEGA_PA_S = -0.421875; // exactly representable: proves verbatim value flow

/** The awphys index: paired U/V rows share one offset (N.1/N.2), APCP is
 * the 12Z running bucket "0-h". */
function fakeParentIndex(forecastHour: number): IdxRecord[] {
  const forecast = `${forecastHour} hour fcst`;
  const records: IdxRecord[] = [];
  let offset = 0;
  const push = (variable: string, level: string, token = forecast): void => {
    records.push({ variable, level, forecast: token, offset, length: 100 });
    offset += 100;
  };
  const pushPair = (level: string): void => {
    // One two-submessage message: the idx lists both components at the
    // message offset; the first parses to zero length, the second spans.
    records.push({ variable: "UGRD", level, forecast, offset, length: 0 });
    records.push({ variable: "VGRD", level, forecast, offset, length: 200 });
    offset += 200;
  };
  push("TMP", "2 m above ground");
  push("DPT", "2 m above ground");
  pushPair("10 m above ground");
  push("HGT", "surface");
  push("TCDC", "entire atmosphere (considered as a single layer)");
  push("LHTFL", "surface");
  push("SHTFL", "surface");
  push("PRMSL", "mean sea level");
  push("GUST", "surface");
  push("CAPE", "surface");
  push("CIN", "surface");
  push("HPBL", "surface");
  push("APCP", "surface", `0-${forecastHour} hour acc fcst`);
  for (const level of PRESSURE_LEVELS) {
    for (const variable of ["TMP", "RH", "HGT"]) {
      push(variable, `${level} mb`);
    }
    pushPair(`${level} mb`);
    // Hour 2's 700 mb VVEL is missing from the index: the level must
    // still publish, just without the optional field.
    if (!(forecastHour === 2 && level === 700)) {
      push("VVEL", `${level} mb`);
    }
  }
  return records;
}

/** The awip12 companion: only the three sigma-layer cloud fractions. */
function fakeAwip12Index(forecastHour: number): IdxRecord[] {
  const forecast = `${forecastHour} hour fcst`;
  return Object.values(CLOUD_LAYER_FIELDS).map(([variable, level], index) => ({
    variable,
    level,
    forecast,
    offset: index * 100,
    length: 100,
  }));
}

function fakeValue(variable: string, level: string, forecast: string): number {
  if (variable === "VVEL") return OMEGA_PA_S;
  if (level === "2 m above ground") return variable === "TMP" ? 293.15 : 283.15;
  if (variable === "HGT") {
    return level === "surface" ? 100.0 : LEVEL_HEIGHTS[Number.parseInt(level, 10)]!;
  }
  if (variable === "TMP") return 273.15;
  if (variable === "RH") return 50.0;
  if (variable === "UGRD" || variable === "VGRD") return 3.0;
  if (variable === "PRMSL") return 101300.0;
  // The 12Z parent's running bucket: 1.5 mm by f01, 4.5 mm by f02, so the
  // differenced second hour is 3 mm.
  if (variable === "APCP") return forecast.startsWith("0-1 ") ? 1.5 : 4.5;
  if (variable === "CIN") return -50.0;
  if (variable === "LCDC" || variable === "MCDC" || variable === "HCDC") return 40.0;
  return 25.0; // cloud cover, the fluxes, and the remaining science fields
}

function fakeWire(): NamWire {
  const sample = (
    variable: string,
    level: string,
    forecast: string,
    sites: readonly SampleSite[],
  ): Record<string, GridPointValue> => {
    const samples: Record<string, GridPointValue> = {};
    for (const site of sites) {
      samples[site.slug] = {
        value: fakeValue(variable, level, forecast),
        latitude: site.latitude,
        longitude: site.longitude,
        distanceKm: 0.0,
      };
    }
    return samples;
  };
  return {
    fetchIndex: async (url) => {
      const forecastHour = Number.parseInt(/(\d{2})\.tm00\.grib2\.idx$/.exec(url)![1]!, 10);
      return url.includes("awip12") ? fakeAwip12Index(forecastHour) : fakeParentIndex(forecastHour);
    },
    fetchRecord: async (_url, record) => record,
    sampleSites: (record, sites, _maxKm) => {
      const { variable, level, forecast } = record as IdxRecord;
      return sample(variable, level, forecast, sites);
    },
    sampleSitesUv: (record, sites, _maxKm) => {
      // The record handed over is the pair's spanning line (VGRD); both
      // components sample identically in this fixture.
      const { level, forecast } = record as IdxRecord;
      return [sample("UGRD", level, forecast, sites), sample("VGRD", level, forecast, sites)];
    },
  };
}

interface PublishedLevel {
  pressureHpa: number;
  windSpeedMps: number;
  windDirectionDeg: number;
  verticalVelocityPaS?: number;
  [key: string]: unknown;
}

interface PublishedProfile {
  site: { timeZone?: string };
  semantics: Record<string, string>;
  hours: Array<{
    surface: Record<string, number>;
    levels: PublishedLevel[];
  }>;
}

it("buildProfiles differences the running bucket, pairs the winds, and routes cloud through awip12", async () => {
  const result = await buildProfiles(
    PARENT,
    { date: "20260807", hour: "12" },
    "2026-08-07T12:00:00Z",
    [SITE as never],
    new DownloadCounters(),
    { maxSteps: 2, wire: fakeWire() },
  );

  expect(result.profiles).toHaveLength(1);
  expect(result.firstForecastHour).toBe(1);
  expect(result.forecastHours).toBe(2);
  expect(result.lastForecastHour).toBe(2);
  const profile = result.profiles[0] as unknown as PublishedProfile;
  expect(profile.site.timeZone).toBe("America/Denver"); // the catalogue echo
  expect(profile.semantics).toEqual({ gust: "instant", precipitation: "windowMeanRate" });
  const [first, second] = profile.hours;
  // f01 right after the 12 h bucket reset IS the step: 1.5 mm/h; f02
  // differences the running bucket: 4.5 − 1.5 = 3 mm over 1 h.
  expect(first!.surface["precipitationMmHr"]).toBeCloseTo(1.5, 9);
  expect(second!.surface["precipitationMmHr"]).toBeCloseTo(3.0, 9);
  // The layered cloud reached the document via the awip12 companion index.
  expect(first!.surface["lowCloudPercent"]).toBe(40.0);
  expect(first!.surface["midCloudPercent"]).toBe(40.0);
  expect(first!.surface["highCloudPercent"]).toBe(40.0);
  // The paired-wind fetch fed the per-product rotation: speed preserved.
  expect(first!.surface["windSpeedMps"]).toBeCloseTo(Math.hypot(3.0, 3.0), 9);
  // Every curated level carries the sampled omega verbatim: Pa/s in,
  // Pa/s out, no unit conversion anywhere in the flow.
  expect(first!.levels.map((level) => level.pressureHpa)).toEqual(
    [...PRESSURE_LEVELS].sort((a, b) => b - a),
  );
  expect(first!.levels.every((level) => level.verticalVelocityPaS === OMEGA_PA_S)).toBe(true);
  // The hour whose 700 mb VVEL record is absent still publishes the level,
  // complete in its required fields, without the optional one.
  const byPressure = new Map(second!.levels.map((level) => [level.pressureHpa, level]));
  expect([...byPressure.keys()].sort((a, b) => a - b)).toEqual(
    [...PRESSURE_LEVELS].sort((a, b) => a - b),
  );
  expect(byPressure.get(700)).not.toHaveProperty("verticalVelocityPaS");
  for (const level of PRESSURE_LEVELS) {
    if (level === 700) continue;
    expect(byPressure.get(level)!.verticalVelocityPaS).toBe(OMEGA_PA_S);
  }
});
