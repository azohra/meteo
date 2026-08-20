import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  MissingRecordError,
  findRecord,
  lambertEarthWind,
  lambertGridRotationDeg,
  parseIdx,
  type IdxRecord,
} from "@azohra/meteo.grib";
import {
  FETCH_CONCURRENCY,
  FORECAST_HOURS,
  LAMBERT_CONE,
  LAMBERT_ORIENTATION_DEG,
  MAX_NEAREST_KM,
  OMEGA_LEVELS,
  OPTIONAL_SURFACE_FIELDS,
  PRESSURE_LEVELS,
  SEMANTICS,
  SLUG,
  SMOKE_FIELDS,
  buildHrrr,
  buildProfiles,
  fileUrl,
  type HrrrWire,
} from "../../src/builders/hrrr.js";
import { packagedModelsPath } from "../../src/catalogue.js";
import { splitMembers } from "../../src/history.js";
import { windFromUv, type GridPointValue, type SampleSite } from "../../src/providers/noaa.js";
import { DownloadCounters } from "../../src/providers/transport.js";
import { stubFetch, useCleanWireEnv } from "../helpers/wire.js";

useCleanWireEnv();

const fixtureIdx = (name: string): IdxRecord[] =>
  parseIdx(
    readFileSync(
      fileURLToPath(new URL(`../../../grib/test/fixtures-idx/${name}`, import.meta.url)),
      "utf-8",
    ),
  );

const earthWind = (uGrid: number, vGrid: number, longitude: number): [number, number] =>
  lambertEarthWind(uGrid, vGrid, longitude, LAMBERT_ORIENTATION_DEG, LAMBERT_CONE);

const gridRotationDeg = (longitude: number): number =>
  lambertGridRotationDeg(longitude, LAMBERT_ORIENTATION_DEG, LAMBERT_CONE);

describe("the Lambert grid rotation", () => {
  it("applies no rotation on the orientation meridian", () => {
    expect(gridRotationDeg(262.5)).toBe(0);
    expect(earthWind(3.0, 4.0, 262.5)).toEqual([3.0, 4.0]);
  });

  it("rotation at the catalogued sites is the documented bias", () => {
    // −117.7°W is 242.3°E; sin(38.5°) × (242.3 − 262.5) ≈ −12.6°.
    expect(gridRotationDeg(242.3)).toBeCloseTo(-12.575, 3);
    expect(gridRotationDeg(-117.7)).toBeCloseTo(gridRotationDeg(242.3), 9);
  });

  it("preserves speed and shifts direction by the local angle", () => {
    // A wind blowing along grid north at 242.3°E: grid north there points
    // 12.6° east of true north, so the wind comes FROM 180° − 12.6°.
    const [uEarth, vEarth] = earthWind(0.0, 10.0, 242.3);
    const [speed, direction] = windFromUv(uEarth, vEarth);

    expect(speed).toBeCloseTo(10.0, 9);
    expect(direction).toBeCloseTo(180 + gridRotationDeg(242.3), 9);
  });

  it("the rotation matrix is orthogonal for an arbitrary wind", () => {
    const [uEarth, vEarth] = earthWind(-7.3, 2.1, 250.0);

    expect(Math.hypot(uEarth, vEarth)).toBeCloseTo(Math.hypot(-7.3, 2.1), 9);
  });
});

describe("the .idx fixture proofs", () => {
  const wrfprs = () => fixtureIdx("hrrr.t12z.wrfprsf24.excerpt.idx");

  it("every science record exists in the wrfprs index", () => {
    // GUST, CAPE/CIN (surface-based), HPBL, and the three sigma-layer cloud
    // fractions all live in the one wrfprs file the builder already reads.
    const records = wrfprs();
    for (const [variable, level] of Object.values(OPTIONAL_SURFACE_FIELDS)) {
      findRecord(records, variable, level, "24 hour fcst");
    }
  });

  it("every smoke record exists in the wrfprs index", () => {
    // HRRRv4's prognostic smoke: MASSDEN (8 m AGL), COLMD and AOTK (entire
    // atmosphere) all live in the one wrfprs file the builder already reads.
    const records = wrfprs();
    for (const [variable, level] of Object.values(SMOKE_FIELDS)) {
      findRecord(records, variable, level, "24 hour fcst");
    }
  });

  it("VVEL exists at every curated level in the wrfprs index", () => {
    // wrfprs carries omega (VVEL, Pa/s, instantaneous) at all nine curated levels.
    const records = wrfprs();
    expect(OMEGA_LEVELS).toBe(PRESSURE_LEVELS);
    for (const pressureHpa of OMEGA_LEVELS) {
      findRecord(records, "VVEL", `${pressureHpa} mb`, "24 hour fcst");
    }
  });

  it("missing records raise the tolerable error type", () => {
    expect(() => findRecord(wrfprs(), "GUST", "surface", "25 hour fcst")).toThrow(
      MissingRecordError,
    );
  });
});

it("models.json matches the HRRR builder configuration", () => {
  const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
    models: Array<{ slug: string; capabilities: Record<string, unknown> }>;
  };
  const capabilities = catalogue.models.find((entry) => entry.slug === "hrrr-conus")!.capabilities;

  expect(capabilities["gust"]).toBe("instant"); // HRRR's GUST is a diagnostic instant
  // PRATE is an instantaneous rate at the valid time (×3600 → mm/h), and
  // the documents' own semantics block says the same.
  expect(capabilities["precipitation"]).toBe("instantRate");
  // HRRRv4's prognostic smoke attenuates its own shortwave (Dowell et al.
  // 2022, WAF, §2d), so the fluxes — and everything derived from them —
  // are already smoke-aware: the catalogue and the documents both say so.
  expect(capabilities["smoke"]).toBe("radiativelyCoupled");
  expect(SEMANTICS).toEqual({
    gust: "instant",
    precipitation: "instantRate",
    smoke: "radiativelyCoupled",
  });
  expect(capabilities["cape"]).toBe(true);
  expect(capabilities["cin"]).toBe(true);
  expect(capabilities["pblHeight"]).toBe(true);
  expect(capabilities["cloudLayers"]).toBe(true);
  expect(capabilities["cloudProfile"]).toBe(false); // wrfprs has no per-level TCDC
  // HRRR publishes its own omega (Pa/s, instantaneous) at every curated level.
  expect(capabilities["verticalVelocity"]).toBe("omega");
  expect(capabilities["verticalVelocityLevels"]).toEqual([...OMEGA_LEVELS]);
});

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

function fakeIndex(forecastHour: number): IdxRecord[] {
  const rows: Array<[string, string]> = [
    ["TMP", "2 m above ground"],
    ["DPT", "2 m above ground"],
    ["UGRD", "10 m above ground"],
    ["VGRD", "10 m above ground"],
    ["HGT", "surface"],
    ["TCDC", "entire atmosphere"],
    ["LHTFL", "surface"],
    ["PRATE", "surface"],
    ["MSLMA", "mean sea level"],
    ["SHTFL", "surface"],
    ["GUST", "surface"],
    ["CAPE", "surface"],
    ["CIN", "surface"],
    ["HPBL", "surface"],
    ["LCDC", "low cloud layer"],
    ["MCDC", "middle cloud layer"],
    ["HCDC", "high cloud layer"],
  ];
  rows.push(["MASSDEN", "8 m above ground"]);
  rows.push(["COLMD", "entire atmosphere (considered as a single layer)"]);
  // Hour 2's AOTK is missing from the index: the smoke block is
  // all-or-nothing, so that hour must publish no smoke at all.
  if (forecastHour !== 2) {
    rows.push(["AOTK", "entire atmosphere (considered as a single layer)"]);
  }
  for (const level of PRESSURE_LEVELS) {
    for (const variable of ["TMP", "DPT", "HGT", "UGRD", "VGRD"]) {
      rows.push([variable, `${level} mb`]);
    }
    // Hour 2's 700 mb VVEL is missing from the index: the level must
    // still publish, just without the optional field.
    if (!(forecastHour === 2 && level === 700)) {
      rows.push(["VVEL", `${level} mb`]);
    }
  }
  const forecast = `${forecastHour} hour fcst`;
  return rows.map(([variable, level], index) => ({
    variable,
    level,
    forecast,
    offset: index * 100,
    length: 100,
  }));
}

function fakeValue(variable: string, level: string): number {
  if (variable === "VVEL") return OMEGA_PA_S;
  if (variable === "MASSDEN") return 2.5e-8; // kg/m³ — the builder publishes µg/m³
  if (variable === "COLMD") return 1.5e-4; // kg/m² — the builder publishes mg/m²
  if (variable === "AOTK") return 0.75; // dimensionless, exactly representable: verbatim flow
  if (level === "2 m above ground") return variable === "TMP" ? 293.15 : 283.15;
  if (variable === "HGT") {
    return level === "surface" ? 100.0 : LEVEL_HEIGHTS[Number.parseInt(level, 10)]!;
  }
  if (variable === "TMP") return 273.15;
  if (variable === "DPT") return 268.15;
  if (variable === "UGRD" || variable === "VGRD") return 3.0;
  if (variable === "PRATE") return 0.0;
  if (variable === "MSLMA") return 101300.0;
  if (variable === "CIN") return -50.0;
  return 25.0; // cloud covers, the fluxes, and the remaining science fields
}

function fakeWire(): HrrrWire {
  return {
    fetchIndex: async (url) => {
      const forecastHour = Number.parseInt(/wrfprsf(\d+)\.grib2\.idx$/.exec(url)![1]!, 10);
      return fakeIndex(forecastHour);
    },
    fetchRecord: async (_url, record) => record,
    sampleSites: (record, sites, _maxKm) => {
      const { variable, level } = record as IdxRecord;
      const samples: Record<string, GridPointValue> = {};
      for (const site of sites) {
        samples[site.slug] = {
          value: fakeValue(variable, level),
          latitude: site.latitude,
          longitude: site.longitude,
          distanceKm: 0.0,
        };
      }
      return samples;
    },
  };
}

interface PublishedLevel {
  pressureHpa: number;
  verticalVelocityPaS?: number;
  [key: string]: unknown;
}

interface PublishedProfile {
  site: { timeZone?: string };
  semantics: Record<string, string>;
  hours: Array<{ levels: PublishedLevel[]; smoke?: Record<string, number> }>;
}

it("buildProfiles publishes omega and smoke and tolerates their absence", async () => {
  const result = await buildProfiles(
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
  expect(profile.semantics).toEqual({
    gust: "instant",
    precipitation: "instantRate",
    smoke: "radiativelyCoupled",
  });
  const [first, second] = profile.hours;
  // Hour 1 publishes the full smoke block in contract units; hour 2, whose
  // AOTK record is absent, publishes no block at all (all-or-nothing).
  expect(first!.smoke!["surfaceUgm3"]).toBeCloseTo(25.0, 9); // 2.5e-8 kg/m³ → µg/m³
  expect(first!.smoke!["columnMgm2"]).toBeCloseTo(150.0, 9); // 1.5e-4 kg/m² → mg/m²
  expect(first!.smoke!["aot"]).toBe(0.75);
  expect(second).not.toHaveProperty("smoke");
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

it("the fetch pool cap and domain guard hold their catalogued values", () => {
  expect(FETCH_CONCURRENCY).toBe(10);
  expect(MAX_NEAREST_KM).toBe(5.0);
  expect(FORECAST_HOURS).toBe(48);
  expect(fileUrl("20260807", "12", 6)).toBe(
    "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20260807/conus/hrrr.t12z.wrfprsf06.grib2",
  );
});

describe("buildHrrr", () => {
  let scratch: string | undefined;
  afterEach(() => {
    if (scratch !== undefined) {
      rmSync(scratch, { recursive: true, force: true });
      scratch = undefined;
    }
  });

  function writeSites(directory: string): string {
    const path = join(directory, "sites.json");
    const catalogue = {
      schemaVersion: 2,
      sites: [
        {
          slug: SITE.slug,
          name: SITE.name,
          latitude: SITE.latitude,
          longitude: SITE.longitude,
          timeZone: SITE.timeZone,
        },
      ],
    };
    writeFileSync(path, JSON.stringify(catalogue));
    return path;
  }

  it("skips a run the dataset already publishes", async () => {
    scratch = mkdtempSync(join(tmpdir(), "hrrr-test-"));
    const sitesPath = writeSites(scratch);
    const manifest = { model: SLUG, referenceTime: "2026-08-07T12:00:00Z", generatedAt: "x" };
    const dataset = stubFetch([{ status: 200, body: JSON.stringify(manifest) }]);
    const lines: string[] = [];

    const built = await buildHrrr({
      sitesPath,
      outputRoot: join(scratch, "data"),
      referenceTime: "2026-08-07T12:00:00Z",
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(),
      log: (line) => lines.push(line),
    });

    expect(built).toBe(false);
    expect(lines).toEqual(["HRRR run 2026-08-07T12:00:00Z is already published."]);
  });

  it("rejects a pin that is not a HRRR cycle stamp", async () => {
    scratch = mkdtempSync(join(tmpdir(), "hrrr-test-"));
    const sitesPath = writeSites(scratch);

    // Only the synoptic cycles run to 48 h — an off-cycle pin is refused.
    await expect(buildHrrr({ sitesPath, referenceTime: "2026-08-07T13:00:00Z" })).rejects.toThrow(
      /not a HRRR synoptic cycle/,
    );
    await expect(buildHrrr({ sitesPath, referenceTime: "20260807T12Z" })).rejects.toThrow(
      /not a HRRR cycle stamp/,
    );
  });

  it("publishes the tree: rounded site documents, history archive with index, manifest", async () => {
    scratch = mkdtempSync(join(tmpdir(), "hrrr-test-"));
    const sitesPath = writeSites(scratch);
    const outputRoot = join(scratch, "data");
    // The empty published dataset: the manifest gate reads 404, then the
    // history seed for the site's month reads 404.
    const dataset = stubFetch([{ status: 404 }, { status: 404 }]);

    const built = await buildHrrr({
      sitesPath,
      outputRoot,
      referenceTime: "2026-08-07T12:00:00Z",
      maxSteps: 2,
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(),
      generatedAt: () => "2026-08-07T18:30:00Z",
      log: () => {},
    });

    expect(built).toBe(true);
    const document = JSON.parse(
      readFileSync(join(outputRoot, SLUG, "sites", "boulder.json"), "utf-8"),
    ) as {
      schemaVersion: number;
      model: string;
      run: { referenceTime: string; generatedAt: string };
      site: { id: string; modelElevationM: number };
      hours: Array<{
        surface: { seaLevelPressureHpa: number; precipitationMmHr: number };
        smoke?: Record<string, number>;
      }>;
    };
    expect(document.model).toBe(SLUG);
    expect(document.run).toEqual({
      referenceTime: "2026-08-07T12:00:00Z",
      generatedAt: "2026-08-07T18:30:00Z",
    });
    expect(document.site.id).toBe("boulder");
    expect(document.site.modelElevationM).toBe(100.0);
    expect(document.hours).toHaveLength(2);
    // MSLMA 101300 Pa → 1013 hPa, rounded per the contract table.
    expect(document.hours[0]!.surface.seaLevelPressureHpa).toBe(1013);
    // PRATE 0 kg/m²/s ×3600 → 0 mm/h.
    expect(document.hours[0]!.surface.precipitationMmHr).toBe(0);
    // The smoke block publishes in contract units on hour 1 and not at all
    // on hour 2 (its AOTK record is absent — all-or-nothing).
    expect(document.hours[0]!.smoke).toEqual({ surfaceUgm3: 25, columnMgm2: 150, aot: 0.75 });
    expect(document.hours[1]).not.toHaveProperty("smoke");

    const manifest = JSON.parse(
      readFileSync(join(outputRoot, SLUG, "manifest.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(manifest["firstForecastHour"]).toBe(1);
    expect(manifest["forecastHours"]).toBe(2);
    expect(manifest["lastForecastHour"]).toBe(2);
    expect(manifest["model"]).toBe(SLUG);
    expect(manifest["referenceTime"]).toBe("2026-08-07T12:00:00Z");
    expect(manifest["schemaVersion"]).toBe(1);
    expect(manifest["sites"]).toEqual([{ name: "Boulder", slug: "boulder" }]);
    expect(Object.keys(manifest["stats"] as Record<string, number>).sort()).toEqual([
      "downloadBytes",
      "downloads",
      "durationMs",
      "retries",
    ]);

    // One run appended as one independent gzip member, one JSON line —
    // and the line IS the site document.
    const archive = readFileSync(join(outputRoot, SLUG, "history", "boulder", "2026-08.jsonl.gz"));
    const members = splitMembers(archive);
    expect(members).toHaveLength(1);
    expect(members[0]!.lines).toHaveLength(1);
    expect(JSON.parse(members[0]!.lines[0]!)).toEqual(document);

    const index = JSON.parse(
      readFileSync(join(outputRoot, SLUG, "history", "boulder", "2026-08.index.json"), "utf-8"),
    ) as { members: Array<{ referenceTime: string; generatedAt: string; lines: number }> };
    expect(index.members).toHaveLength(1);
    expect(index.members[0]!.referenceTime).toBe("2026-08-07T12:00:00Z");
    expect(index.members[0]!.lines).toBe(1);
  });
});
