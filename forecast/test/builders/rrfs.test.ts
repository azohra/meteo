import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MissingRecordError, findRecord, parseIdx, type IdxRecord } from "@azohra/meteo.grib";
import {
  DEFAULT_BASE_URL,
  FETCH_CONCURRENCY,
  FORECAST_HOURS,
  MAX_NEAREST_KM,
  OPTIONAL_SURFACE_FIELDS,
  PRESSURE_LEVELS,
  RUN_HOURS,
  SEMANTICS,
  SLUG,
  SMOKE_FIELDS,
  SMOKE_QUALIFIER,
  SURFACE_FIELDS,
  VERTICAL_VELOCITY_LEVELS,
  buildProfiles,
  buildRrfs,
  fileUrl,
  omegaFromGeometricW,
  type RrfsWire,
} from "../../src/builders/rrfs.js";
import { packagedModelsPath } from "../../src/catalogue.js";
import { splitMembers } from "../../src/history.js";
import type { GridPointValue, SampleSite } from "../../src/providers/noaa.js";
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

describe("the .idx fixture proofs", () => {
  const prslev = () => fixtureIdx("rrfs.t06z.prslev.3km.f012.conus.excerpt.idx");
  const surface = () => fixtureIdx("rrfs.t06z.2dfld.3km.f012.conus.excerpt.idx");

  it("the full curated band exists in prslev, dew point included", () => {
    // Unlike NAM, RRFS publishes DPT at every band level — no RH conversion.
    const records = prslev();
    for (const pressureHpa of PRESSURE_LEVELS) {
      for (const variable of ["TMP", "DPT", "HGT", "UGRD", "VGRD"]) {
        findRecord(records, variable, `${pressureHpa} mb`, "12 hour fcst");
      }
    }
  });

  it("vertical velocity is DZDT at every curated level — VVEL does not exist", () => {
    const records = prslev();
    expect(VERTICAL_VELOCITY_LEVELS).toBe(PRESSURE_LEVELS);
    for (const pressureHpa of VERTICAL_VELOCITY_LEVELS) {
      findRecord(records, "DZDT", `${pressureHpa} mb`, "12 hour fcst");
      expect(() => findRecord(records, "VVEL", `${pressureHpa} mb`, "12 hour fcst")).toThrow(
        MissingRecordError,
      );
    }
  });

  it("every surface and science record exists in the 2dfld companion", () => {
    const records = surface();
    for (const [variable, level] of Object.values(SURFACE_FIELDS)) {
      findRecord(records, variable, level, "12 hour fcst");
    }
    for (const [variable, level] of Object.values(OPTIONAL_SURFACE_FIELDS)) {
      findRecord(records, variable, level, "12 hour fcst");
    }
    findRecord(records, "TMP", "2 m above ground", "12 hour fcst");
    findRecord(records, "DPT", "2 m above ground", "12 hour fcst");
    findRecord(records, "UGRD", "10 m above ground", "12 hour fcst");
    findRecord(records, "VGRD", "10 m above ground", "12 hour fcst");
    findRecord(records, "HGT", "surface", "12 hour fcst");
  });

  it("the instantaneous flux records stand apart from the hour-average twins", () => {
    const records = surface();
    for (const variable of ["SHTFL", "LHTFL"]) {
      const instantaneous = findRecord(records, variable, "surface", "12 hour fcst");
      const averaged = findRecord(records, variable, "surface", "11-12 hour ave fcst");
      expect(instantaneous.offset).not.toBe(averaged.offset);
    }
  });

  it("precipitation is a fixed one-hour bucket beside the run total", () => {
    const records = surface();
    const windowed = findRecord(records, "APCP", "surface", "11-12 hour acc fcst");
    const runTotal = findRecord(records, "APCP", "surface", "0-12 hour acc fcst");
    expect(windowed.offset).not.toBe(runTotal.offset);
  });

  it("the smoke block's records exist and the qualifier separates smoke from dust", () => {
    const records = surface();
    for (const [variable, level, qualifier] of Object.values(SMOKE_FIELDS)) {
      findRecord(records, variable, level, "12 hour fcst", qualifier);
    }
    // The same variable/level/forecast triple names the dust tracer too —
    // only the qualifier keeps the smoke block reading smoke.
    const dust = findRecord(
      records,
      "MASSDEN",
      "8 m above ground",
      "12 hour fcst",
      "aerosol=Dust dry:aerosol_size <2.5e-06",
    );
    const smoke = findRecord(
      records,
      "MASSDEN",
      "8 m above ground",
      "12 hour fcst",
      SMOKE_QUALIFIER,
    );
    expect(dust.offset).not.toBe(smoke.offset);
  });

  it("MSL pressure is MSLET — not HRRR's MSLMA or NAM's PRMSL", () => {
    const records = surface();
    findRecord(records, "MSLET", "mean sea level", "12 hour fcst");
    expect(() => findRecord(records, "MSLMA", "mean sea level", "12 hour fcst")).toThrow(
      MissingRecordError,
    );
    expect(() => findRecord(records, "PRMSL", "mean sea level", "12 hour fcst")).toThrow(
      MissingRecordError,
    );
  });
});

describe("omegaFromGeometricW", () => {
  it("applies ω = −ρgw with dry-air density at the level", () => {
    // ρ = 85000 / (287.05 × 280) = 1.05758… kg/m³; ω = −ρ × 9.80665 × 0.5.
    const expected = -((85000 / (287.05 * 280)) * 9.80665 * 0.5);
    expect(omegaFromGeometricW(0.5, 850, 280)).toBeCloseTo(expected, 12);
    expect(omegaFromGeometricW(0.5, 850, 280)).toBeCloseTo(-5.186, 3);
  });

  it("rising air (w > 0) is lift (ω < 0), and calm is calm", () => {
    expect(omegaFromGeometricW(1.0, 700, 270)).toBeLessThan(0);
    expect(omegaFromGeometricW(-1.0, 700, 270)).toBeGreaterThan(0);
    expect(omegaFromGeometricW(0.0, 700, 270)).toBeCloseTo(0, 12);
  });
});

it("models.json matches the RRFS builder configuration", () => {
  const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
    models: Array<{
      slug: string;
      horizonHours: number;
      runIntervalHours: number;
      experimental: boolean;
      sunset?: { successor: string | null };
      capabilities: Record<string, unknown>;
    }>;
  };
  const entry = catalogue.models.find((model) => model.slug === SLUG)!;

  expect(entry.horizonHours).toBe(FORECAST_HOURS);
  // Only the synoptic cycles publish the isobaric files the profile needs.
  expect(entry.runIntervalHours).toBe(6);
  expect(RUN_HOURS).toEqual(["18", "12", "06", "00"]);
  // Unproven against a production tick: experimental until the operational
  // feed lands and a real scheduled run survives.
  expect(entry.experimental).toBe(true);
  expect(entry.capabilities["gust"]).toBe("instant");
  expect(entry.capabilities["precipitation"]).toBe("windowMeanRate");
  // RRFS-SD's aerosol direct feedback attenuates the model's own radiation
  // (Li et al. 2025, GRL), so derived quantities are already smoke-aware.
  expect(entry.capabilities["smoke"]).toBe("radiativelyCoupled");
  expect(SEMANTICS).toEqual({
    gust: "instant",
    precipitation: "windowMeanRate",
    smoke: "radiativelyCoupled",
  });
  expect(entry.capabilities["cape"]).toBe(true);
  expect(entry.capabilities["cin"]).toBe(true);
  expect(entry.capabilities["pblHeight"]).toBe(true);
  expect(entry.capabilities["cloudLayers"]).toBe(true);
  expect(entry.capabilities["cloudProfile"]).toBe(false);
  // RRFS publishes geometric w (DZDT), converted at build — declared so
  // consumers can label converted values differently from native omega.
  expect(entry.capabilities["verticalVelocity"]).toBe("fromGeometricW");
  expect(entry.capabilities["verticalVelocityLevels"]).toEqual([...VERTICAL_VELOCITY_LEVELS]);
  expect(entry.capabilities["pressureLevels"]).toEqual([...PRESSURE_LEVELS]);

  // Both retiring NAM entries name this builder's slug as their successor.
  for (const slug of ["nam", "nam-conus-nest"]) {
    const nam = catalogue.models.find((model) => model.slug === slug)!;
    expect(nam.sunset?.successor, slug).toBe(SLUG);
  }
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
const GEOMETRIC_W_MPS = 0.5; // exactly representable: proves the conversion is the only transform
const LEVEL_TMP_K = 273.15;

function fakeIndex(fileToken: string, forecastHour: number): IdxRecord[] {
  const forecast = `${forecastHour} hour fcst`;
  const rows: Array<[string, string, string, string?]> = [];
  if (fileToken === "2dfld") {
    rows.push(
      ["TMP", "2 m above ground", forecast],
      ["DPT", "2 m above ground", forecast],
      ["UGRD", "10 m above ground", forecast],
      ["VGRD", "10 m above ground", forecast],
      ["HGT", "surface", forecast],
      ["TCDC", "entire atmosphere (considered as a single layer)", forecast],
      ["LHTFL", "surface", forecast],
      ["SHTFL", "surface", forecast],
      ["LHTFL", "surface", `${forecastHour - 1}-${forecastHour} hour ave fcst`],
      ["SHTFL", "surface", `${forecastHour - 1}-${forecastHour} hour ave fcst`],
      ["MSLET", "mean sea level", forecast],
      ["APCP", "surface", `${forecastHour - 1}-${forecastHour} hour acc fcst`],
      ["APCP", "surface", `0-${forecastHour} hour acc fcst`],
      ["GUST", "surface", forecast],
      ["CAPE", "surface", forecast],
      ["CIN", "surface", forecast],
      ["HPBL", "surface", forecast],
      ["LCDC", "low cloud layer", forecast],
      ["MCDC", "middle cloud layer", forecast],
      ["HCDC", "high cloud layer", forecast],
    );
    // The speciated aerosol menu: dust rides beside smoke on the same
    // variable/level/forecast triple. Hour 2's AOTK is missing so the
    // all-or-nothing block publishes nothing that hour.
    rows.push(["MASSDEN", "8 m above ground", forecast, "aerosol=Dust dry:aerosol_size <2.5e-06"]);
    rows.push(["MASSDEN", "8 m above ground", forecast, SMOKE_QUALIFIER]);
    rows.push([
      "COLMD",
      "entire atmosphere (considered as a single layer)",
      forecast,
      "aerosol=Dust dry:aerosol_size <2.5e-06",
    ]);
    rows.push([
      "COLMD",
      "entire atmosphere (considered as a single layer)",
      forecast,
      SMOKE_QUALIFIER,
    ]);
    if (forecastHour !== 2) {
      rows.push(["AOTK", "entire atmosphere (considered as a single layer)", forecast, ""]);
    }
  } else {
    for (const level of PRESSURE_LEVELS) {
      for (const variable of ["TMP", "DPT", "HGT", "UGRD", "VGRD"]) {
        rows.push([variable, `${level} mb`, forecast]);
      }
      // Hour 2's 700 mb DZDT is missing from the index: the level must
      // still publish, just without the optional field.
      if (!(forecastHour === 2 && level === 700)) {
        rows.push(["DZDT", `${level} mb`, forecast]);
      }
    }
  }
  return rows.map(([variable, level, recordForecast, qualifier], index) => ({
    variable,
    level,
    forecast: recordForecast,
    qualifier: qualifier ?? "",
    offset: index * 100,
    length: 100,
  }));
}

function fakeValue(variable: string, level: string, qualifier: string): number {
  if (variable === "DZDT") return GEOMETRIC_W_MPS;
  if (variable === "MASSDEN") {
    // The dust twin is poison: a build that reads it publishes dust as smoke.
    return qualifier === SMOKE_QUALIFIER ? 2.5e-8 : 9.9e-6;
  }
  if (variable === "COLMD") {
    return qualifier === SMOKE_QUALIFIER ? 1.5e-4 : 9.9e-2;
  }
  if (variable === "AOTK") return 0.75;
  if (level === "2 m above ground") return variable === "TMP" ? 293.15 : 283.15;
  if (variable === "HGT") {
    return level === "surface" ? 100.0 : LEVEL_HEIGHTS[Number.parseInt(level, 10)]!;
  }
  if (variable === "TMP") return LEVEL_TMP_K;
  if (variable === "DPT") return LEVEL_TMP_K - 5.0;
  if (variable === "UGRD" || variable === "VGRD") return 3.0;
  if (variable === "APCP") return 0.0;
  if (variable === "MSLET") return 101300.0;
  if (variable === "CIN") return -50.0;
  return 25.0; // cloud covers, the fluxes, and the remaining science fields
}

function fakeWire(): RrfsWire {
  return {
    fetchIndex: async (url) => {
      const match = /rrfs\.t\d{2}z\.(prslev|2dfld)\.3km\.f(\d{3})\.conus\.grib2\.idx$/.exec(url)!;
      return fakeIndex(match[1]!, Number.parseInt(match[2]!, 10));
    },
    fetchRecord: async (_url, record) => record,
    sampleSites: (record, sites, _maxKm) => {
      const { variable, level, qualifier } = record as IdxRecord;
      const samples: Record<string, GridPointValue> = {};
      for (const site of sites) {
        samples[site.slug] = {
          value: fakeValue(variable, level, qualifier ?? ""),
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

it("buildProfiles converts DZDT to omega, publishes smoke by species, and tolerates absence", async () => {
  const result = await buildProfiles(
    { date: "20260813", hour: "12" },
    "2026-08-13T12:00:00Z",
    [SITE as never],
    new DownloadCounters(),
    { maxSteps: 2, wire: fakeWire() },
  );

  expect(result.profiles).toHaveLength(1);
  expect(result.firstForecastHour).toBe(1);
  expect(result.forecastHours).toBe(2);
  expect(result.lastForecastHour).toBe(2);
  const profile = result.profiles[0] as unknown as PublishedProfile;
  expect(profile.site.timeZone).toBe("America/Denver");
  expect(profile.semantics).toEqual({
    gust: "instant",
    precipitation: "windowMeanRate",
    smoke: "radiativelyCoupled",
  });
  const [first, second] = profile.hours;
  // The smoke block reads the organic-matter tracer, never the dust twin
  // beside it, and converts to contract units; hour 2, whose AOTK record
  // is absent, publishes no block at all (all-or-nothing).
  expect(first!.smoke!["surfaceUgm3"]).toBeCloseTo(25.0, 9); // 2.5e-8 kg/m³ → µg/m³
  expect(first!.smoke!["columnMgm2"]).toBeCloseTo(150.0, 9); // 1.5e-4 kg/m² → mg/m²
  expect(first!.smoke!["aot"]).toBe(0.75);
  expect(second).not.toHaveProperty("smoke");
  // Every level publishes ω = −ρgw computed from its own pressure and
  // temperature — deeper levels are denser, so |ω| grows with pressure.
  expect(first!.levels.map((level) => level.pressureHpa)).toEqual(
    [...PRESSURE_LEVELS].sort((a, b) => b - a),
  );
  for (const level of first!.levels) {
    expect(level.verticalVelocityPaS).toBeCloseTo(
      omegaFromGeometricW(GEOMETRIC_W_MPS, level.pressureHpa, LEVEL_TMP_K),
      12,
    );
  }
  // The hour whose 700 mb DZDT record is absent still publishes the level,
  // complete in its required fields, without the optional one.
  const byPressure = new Map(second!.levels.map((level) => [level.pressureHpa, level]));
  expect([...byPressure.keys()].sort((a, b) => a - b)).toEqual(
    [...PRESSURE_LEVELS].sort((a, b) => a - b),
  );
  expect(byPressure.get(700)).not.toHaveProperty("verticalVelocityPaS");
  for (const level of PRESSURE_LEVELS) {
    if (level === 700) continue;
    expect(byPressure.get(level)!.verticalVelocityPaS).toBeCloseTo(
      omegaFromGeometricW(GEOMETRIC_W_MPS, level, LEVEL_TMP_K),
      12,
    );
  }
});

describe("the transport shape", () => {
  it("the fetch pool cap and domain guard hold their catalogued values", () => {
    expect(FETCH_CONCURRENCY).toBe(10);
    expect(MAX_NEAREST_KM).toBe(5.0);
    expect(FORECAST_HOURS).toBe(84);
    expect(fileUrl("prslev", "20260813", "12", 6)).toBe(
      `${DEFAULT_BASE_URL}/rrfs.20260813/12/rrfs.t12z.prslev.3km.f006.conus.grib2`,
    );
    expect(fileUrl("2dfld", "20260813", "06", 84)).toBe(
      `${DEFAULT_BASE_URL}/rrfs.20260813/06/rrfs.t06z.2dfld.3km.f084.conus.grib2`,
    );
  });

  it("METEO_RRFS_BASE re-points the transport at the para/prod prefix without a release", () => {
    process.env["METEO_RRFS_BASE"] = "https://noaa-rrfs-pds.s3.amazonaws.com/rrfs/v1.0/";
    expect(fileUrl("prslev", "20261006", "12", 1)).toBe(
      "https://noaa-rrfs-pds.s3.amazonaws.com/rrfs/v1.0/rrfs.20261006/12/rrfs.t12z.prslev.3km.f001.conus.grib2",
    );
  });
});

describe("buildRrfs", () => {
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
    scratch = mkdtempSync(join(tmpdir(), "rrfs-test-"));
    const sitesPath = writeSites(scratch);
    const manifest = { model: SLUG, referenceTime: "2026-08-13T12:00:00Z", generatedAt: "x" };
    const dataset = stubFetch([{ status: 200, body: JSON.stringify(manifest) }]);
    const lines: string[] = [];

    const built = await buildRrfs({
      sitesPath,
      outputRoot: join(scratch, "data"),
      referenceTime: "2026-08-13T12:00:00Z",
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(),
      log: (line) => lines.push(line),
    });

    expect(built).toBe(false);
    expect(lines).toEqual(["RRFS run 2026-08-13T12:00:00Z is already published."]);
  });

  it("rejects a pin that is not a RRFS synoptic cycle", async () => {
    scratch = mkdtempSync(join(tmpdir(), "rrfs-test-"));
    const sitesPath = writeSites(scratch);

    // The other hourly cycles publish no isobaric files — a 13Z pin is refused.
    await expect(buildRrfs({ sitesPath, referenceTime: "2026-08-13T13:00:00Z" })).rejects.toThrow(
      /not a RRFS synoptic cycle/,
    );
    await expect(buildRrfs({ sitesPath, referenceTime: "20260813T12Z" })).rejects.toThrow(
      /not a RRFS cycle stamp/,
    );
  });

  it("publishes the tree: rounded site documents, history archive with index, manifest", async () => {
    scratch = mkdtempSync(join(tmpdir(), "rrfs-test-"));
    const sitesPath = writeSites(scratch);
    const outputRoot = join(scratch, "data");
    // The empty published dataset: the manifest gate reads 404, then the
    // history seed for the site's month reads 404 — absence, not fatality.
    const dataset = stubFetch([{ status: 404 }, { status: 404 }]);

    const built = await buildRrfs({
      sitesPath,
      outputRoot,
      referenceTime: "2026-08-13T12:00:00Z",
      maxSteps: 2,
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(),
      generatedAt: () => "2026-08-13T18:30:00Z",
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
      referenceTime: "2026-08-13T12:00:00Z",
      generatedAt: "2026-08-13T18:30:00Z",
    });
    expect(document.site.id).toBe("boulder");
    expect(document.site.modelElevationM).toBe(100.0);
    expect(document.hours).toHaveLength(2);
    // MSLET 101300 Pa → 1013 hPa, rounded per the contract table.
    expect(document.hours[0]!.surface.seaLevelPressureHpa).toBe(1013);
    // APCP 0 mm over the one-hour bucket → 0 mm/h.
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
    expect(manifest["referenceTime"]).toBe("2026-08-13T12:00:00Z");
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
    expect(index.members[0]!.referenceTime).toBe("2026-08-13T12:00:00Z");
    expect(index.members[0]!.lines).toBe(1);
  });
});
