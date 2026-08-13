import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { J2kSamples } from "@azohra/meteo.grib";
import { packagedModelsPath } from "../../src/catalogue.js";
import { NotFoundError } from "../../src/providers/datamart.js";
import { DownloadCounters } from "../../src/providers/transport.js";
import type { Site } from "../../src/sites.js";
import { liveDatamartWire, type DatamartWire } from "../../src/builders/eccc.js";
import {
  BASE_URL,
  CAPE_SENTINEL,
  CAPE_VARIABLE,
  FETCH_CONCURRENCY,
  FORECAST_HOURS,
  GUST_INSTANT_VARIABLE,
  GUST_MAX_VARIABLE,
  PBL_VARIABLE,
  PRESSURE_FIELDS,
  PRESSURE_LEVELS,
  RUN_HOURS,
  SEMANTICS,
  SLUG,
  SURFACE_FIELDS,
  TERRAIN_VARIABLE,
  buildProfiles,
  fileUrl,
  forecastHours,
  pinnedRun,
} from "../../src/builders/hrdps-west.js";
import { useCleanWireEnv } from "../helpers/wire.js";

useCleanWireEnv();

const DUNDEE: Site = {
  slug: "dundee",
  name: "Dundee",
  latitude: 49.291977,
  longitude: -117.183569,
  timeZone: "America/Vancouver",
};

it("file URLs match the alpha Datamart layout", () => {
  expect(fileUrl("TMP_TGL_2", "20260808", "00", 48)).toBe(
    "https://dd.alpha.weather.gc.ca/model_hrdps/west/1km/grib2/00/048/" +
      "CMC_hrdps_west_TMP_TGL_2_rotated_latlon0.009x0.009_20260808T00Z_P048-00.grib2",
  );
  expect(fileUrl("DEPR_ISBL_0925", "20260808", "12", 1)).toBe(
    "https://dd.alpha.weather.gc.ca/model_hrdps/west/1km/grib2/12/001/" +
      "CMC_hrdps_west_DEPR_ISBL_0925_rotated_latlon0.009x0.009_20260808T12Z_P001-00.grib2",
  );
});

it("the alpha host ignores METEO_DATAMART_BASE by design", () => {
  // The alpha Datamart is not mirrored on hpfx — the override that
  // redirects the other ECCC builders must leave this feed on dd.alpha.
  process.env["METEO_DATAMART_BASE"] = "https://hpfx.collab.science.gc.ca";
  expect(fileUrl("TMP_TGL_2", "20260808", "00", 1).startsWith(BASE_URL)).toBe(true);
  expect(BASE_URL).toBe("https://dd.alpha.weather.gc.ca/model_hrdps/west/1km/grib2");
});

it("the static configuration matches the feed", () => {
  expect(RUN_HOURS).toEqual(["12", "00"]);
  expect(FORECAST_HOURS).toBe(48);
  expect(FETCH_CONCURRENCY).toBe(5); // the shared per-host Datamart budget
  expect(PRESSURE_LEVELS).toEqual([925, 900, 875, 850, 800, 750, 700, 650, 600]);
  expect(TERRAIN_VARIABLE).toBe("HGT_SFC_0");
  expect(CAPE_VARIABLE).toBe("CAPE_ETAL_10000"); // eta 1.0 — surface-based
  expect(CAPE_SENTINEL).toBe(-1.0); // the HRDPS family's "not computed"
  // PRATE is an instantaneous rate; the gust is ECCC's hour-max.
  expect(SEMANTICS).toEqual({ gust: "hourMax", precipitation: "instantRate" });
});

it("models.json matches the builder configuration", () => {
  const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
    models: Array<{ slug: string; capabilities: Record<string, unknown> }>;
  };
  const entry = catalogue.models.find((model) => model.slug === SLUG)!;
  expect(entry.capabilities["pressureLevels"]).toEqual([...PRESSURE_LEVELS]);
  expect(entry.capabilities["verticalVelocity"]).toBe(false); // no VVEL on the 1 km feed
  expect(entry.capabilities["gust"]).toBe("hourMax");
  expect(entry.capabilities["precipitation"]).toBe("instantRate");
  expect(entry.capabilities["cape"]).toBe(true);
  expect(entry.capabilities["cin"]).toBe(false); // the HRDPS family has none
  expect(entry.capabilities["pblHeight"]).toBe(true);
});

it("METEO_MAX_STEPS caps the schedule", () => {
  expect(forecastHours()).toEqual(Array.from({ length: 48 }, (_, index) => index + 1));
  process.env["METEO_MAX_STEPS"] = "3";
  try {
    expect(forecastHours()).toEqual([1, 2, 3]);
  } finally {
    delete process.env["METEO_MAX_STEPS"];
  }
});

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

function fakeDatamart(date: string, runHour: string): Map<string, number> {
  const url = (variable: string, hour: number): string => fileUrl(variable, date, runHour, hour);
  const store = new Map<string, number>();
  const surface: Record<string, (hour: number) => number> = {
    TCDC_SFC_0: () => 40.0,
    DEPR_TGL_2: () => 10.0,
    LHTFL_SFC_0: () => 50.0,
    PRATE_SFC_0: () => 0.001, // kg/m²/s ×3600 → 3.6 mm/h
    PRMSL_MSL_0: () => 101300.0, // Pa → 1013 hPa
    SHTFL_SFC_0: () => 200.0,
    TMP_TGL_2: (hour) => 293.15 + hour, // K → °C
    WDIR_TGL_10: () => 246.0,
    WIND_TGL_10: () => 1.5,
    [GUST_MAX_VARIABLE]: () => 9.4,
    [GUST_INSTANT_VARIABLE]: () => 6.1,
    // Hour 2's CAPE is the family's -1 "not computed" sentinel — the
    // position must vanish, not publish (and never read as -1 J/kg).
    [CAPE_VARIABLE]: (hour) => ({ 1: 850.0, 2: -1.0 })[hour]!,
  };
  // Terrain is sampled at the FIRST forecast hour (the alpha tree has no
  // PT000 directory) and sits below every fixture level — the derivation
  // drops levels under the model's own ground. PBL exists at hour 1 only —
  // hour 2's 404 tolerated.
  store.set(url(TERRAIN_VARIABLE, 1), 500.0);
  store.set(url(PBL_VARIABLE, 1), 1650.0);
  for (const hour of [1, 2]) {
    for (const [variable, value] of Object.entries(surface)) {
      store.set(url(variable, hour), value(hour));
    }
    // Unlike the eccc builder, a missing pressure-level file is FATAL —
    // every level publishes every hour.
    for (const level of PRESSURE_LEVELS) {
      const token = String(level).padStart(4, "0");
      store.set(url(`TMP_ISBL_${token}`, hour), 283.15);
      store.set(url(`DEPR_ISBL_${token}`, hour), 5.0);
      store.set(url(`HGT_ISBL_${token}`, hour), LEVEL_HEIGHTS[level]!);
      store.set(url(`WDIR_ISBL_${token}`, hour), 250.0);
      store.set(url(`WIND_ISBL_${token}`, hour), 8.0);
    }
  }
  return store;
}

function fakeWire(store: Map<string, number>): DatamartWire {
  return {
    fetchBytes: async (url) => {
      if (!store.has(url)) {
        throw new NotFoundError(`Datamart ${url} returned 404`);
      }
      return new TextEncoder().encode(url);
    },
    sampleSites: async (message, sites, maxDistanceKm) => {
      // The builder must pass no distance cap on this feed.
      expect(maxDistanceKm).toBeUndefined();
      const value = store.get(new TextDecoder().decode(message))!;
      return Object.fromEntries(sites.map((site) => [site.slug, value]));
    },
  };
}

interface PublishedProfile {
  model: string;
  site: { modelElevationM: number; timeZone?: string };
  semantics: Record<string, string>;
  hours: Array<{
    validAt: string;
    surface: Record<string, number>;
    levels: Array<{ pressureHpa: number; [key: string]: unknown }>;
  }>;
}

describe("buildProfiles", () => {
  it("publishes the converted series end-to-end", async () => {
    const result = await buildProfiles(
      { date: "20260808", hour: "00" },
      "2026-08-08T00:00:00Z",
      [DUNDEE],
      new DownloadCounters(),
      { maxSteps: 2, wire: fakeWire(fakeDatamart("20260808", "00")) },
    );

    expect(result.firstForecastHour).toBe(1);
    expect(result.forecastHours).toBe(2);
    expect(result.lastForecastHour).toBe(2);
    const profile = result.profiles[0] as unknown as PublishedProfile;
    expect(profile.model).toBe(SLUG);
    expect(profile.site.modelElevationM).toBe(500.0);
    expect(profile.site.timeZone).toBe("America/Vancouver");
    expect(profile.semantics).toEqual({ gust: "hourMax", precipitation: "instantRate" });

    const [first, second] = profile.hours;
    expect(first!.validAt).toBe("2026-08-08T01:00:00Z");
    expect(second!.validAt).toBe("2026-08-08T02:00:00Z");
    // The conversions: K→°C, Pa→hPa, and PRATE kg/m²/s ×3600 → mm/h.
    expect(first!.surface["temperatureC"]).toBeCloseTo(21.0, 9);
    expect(first!.surface["seaLevelPressureHpa"]).toBe(1013);
    expect(first!.surface["precipitationMmHr"]).toBeCloseTo(3.6, 9);
    expect(first!.surface["dewPointC"]).toBeCloseTo(11.0, 9); // T − published DEPR

    // Science fields: hour-max gust, CAPE with the -1 sentinel masked at
    // hour 2, PBL only where the file existed.
    expect(first!.surface["windGustMps"]).toBe(9.4);
    expect(first!.surface["capeJkg"]).toBe(850.0);
    expect(second!.surface).not.toHaveProperty("capeJkg"); // -1 sentinel masked
    expect(first!.surface["pblHeightM"]).toBe(1650.0);
    expect(second!.surface).not.toHaveProperty("pblHeightM"); // tolerated 404

    // The column: every curated level, complete, both hours.
    for (const hour of [first!, second!]) {
      expect(hour.levels.map((level) => level.pressureHpa)).toEqual([
        925, 900, 875, 850, 800, 750, 700, 650, 600,
      ]);
    }
  });

  it("a missing pressure-level file is fatal, matching Python's posture", async () => {
    // hrdps_west.pressure_task carries no NotFoundError tolerance (only
    // the science fields do) — an absent level file kills the build.
    const store = fakeDatamart("20260808", "00");
    store.delete(fileUrl("DEPR_ISBL_0600", "20260808", "00", 2));
    await expect(
      buildProfiles(
        { date: "20260808", hour: "00" },
        "2026-08-08T00:00:00Z",
        [DUNDEE],
        new DownloadCounters(),
        { maxSteps: 2, wire: fakeWire(store) },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("fails loudly when gust semantics break", async () => {
    const store = fakeDatamart("20260808", "00");
    for (const hour of [1, 2]) {
      store.set(fileUrl(GUST_MAX_VARIABLE, "20260808", "00", hour), 3.0);
    }
    await expect(
      buildProfiles(
        { date: "20260808", hour: "00" },
        "2026-08-08T00:00:00Z",
        [DUNDEE],
        new DownloadCounters(),
        { maxSteps: 2, wire: fakeWire(store) },
      ),
    ).rejects.toThrow(/Gust semantics broke/);
  });

  it("tolerates a dark gust/CAPE/PBL feed as absence", async () => {
    // The alpha feed thins out: every optional science file 404s and the
    // document simply carries none of them.
    const store = fakeDatamart("20260808", "00");
    for (const hour of [1, 2]) {
      for (const variable of [GUST_MAX_VARIABLE, GUST_INSTANT_VARIABLE, CAPE_VARIABLE]) {
        store.delete(fileUrl(variable, "20260808", "00", hour));
      }
    }
    store.delete(fileUrl(PBL_VARIABLE, "20260808", "00", 1));

    const result = await buildProfiles(
      { date: "20260808", hour: "00" },
      "2026-08-08T00:00:00Z",
      [DUNDEE],
      new DownloadCounters(),
      { maxSteps: 2, wire: fakeWire(store) },
    );
    const profile = result.profiles[0] as unknown as PublishedProfile;
    for (const hour of profile.hours) {
      expect(hour.surface).not.toHaveProperty("windGustMps");
      expect(hour.surface).not.toHaveProperty("capeJkg");
      expect(hour.surface).not.toHaveProperty("pblHeightM");
    }
  });
});

/* --- The decode-once rule through this builder's live wire. ---
 *
 * A minimal synthetic DRT 5.40 GRIB2 message (trimmed from eccc.test.ts's
 * builder — copied, per the shared-harness rule): an 11×8, 0.1° grid
 * around Dundee whose 4-byte section 7 payload stands in for a
 * codestream, so the injected JPEG 2000 decode seam must fire. */

function ju16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}
function ju32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function jsection(number: number, body: number[]): number[] {
  return [...ju32(body.length + 5), number, ...body];
}
function jmicroSigned(degrees: number): number[] {
  const bytes = ju32(Math.round(Math.abs(degrees) * 1e6));
  if (degrees < 0) bytes[0] = bytes[0]! | 0x80;
  return bytes;
}
function jmicroUnsigned(degrees: number): number[] {
  return ju32(Math.round((((degrees % 360) + 360) % 360) * 1e6));
}

function makeJ2kGrib(): Uint8Array {
  const ni = 11;
  const nj = 8;
  const firstLat = 49.6;
  const firstLon = 242.0;
  const section1 = jsection(1, [
    ...ju16(54),
    ...ju16(0),
    28,
    0,
    1,
    ...ju16(2026),
    8,
    8,
    0,
    0,
    0,
    0,
    1,
  ]);
  const section3 = jsection(3, [
    0,
    ...ju32(ni * nj),
    0,
    0,
    ...ju16(0), // template 3.0
    6,
    0,
    ...ju32(0),
    0,
    ...ju32(0),
    0,
    ...ju32(0),
    ...ju32(ni),
    ...ju32(nj),
    ...ju32(0),
    ...ju32(0),
    ...jmicroSigned(firstLat),
    ...jmicroUnsigned(firstLon),
    0x30,
    ...jmicroSigned(firstLat - (nj - 1) * 0.1),
    ...jmicroUnsigned(firstLon + (ni - 1) * 0.1),
    ...ju32(Math.round(0.1 * 1e6)),
    ...ju32(Math.round(0.1 * 1e6)),
    0, // scanning mode: i+, j-
  ]);
  const section4 = jsection(4, [
    ...ju16(0),
    ...ju16(0),
    0,
    0,
    2,
    255,
    255,
    ...ju16(0),
    0,
    1,
    ...ju32(1),
    103,
    0,
    ...ju32(10),
    255,
    255,
    ...ju32(0xffffffff),
  ]);
  const section5 = jsection(5, [
    ...ju32(ni * nj),
    ...ju16(40), // DRT 5.40: JPEG 2000
    0,
    0,
    0,
    0, // reference value 0 (float32), so value = raw sample
    ...ju16(0), // binary scale 0
    ...ju16(0), // decimal scale 0
    8, // bitsPerValue nonzero: the codestream decoder must run
    0, // original field type
    0, // compression type: lossless
    255, // target compression ratio: missing
  ]);
  const section6 = jsection(6, [255]);
  const section7 = jsection(7, [0x11, 0x22, 0x33, 0x44]);
  const body = [...section1, ...section3, ...section4, ...section5, ...section6, ...section7];
  const total = 16 + body.length + 4;
  return new Uint8Array([
    0x47,
    0x52,
    0x49,
    0x42,
    0,
    0,
    0,
    2,
    ...ju32(0),
    ...ju32(total),
    ...body,
    0x37,
    0x37,
    0x37,
    0x37,
  ]);
}

it("concurrent samples of one message decode it exactly once", async () => {
  // The wire this builder walks live (liveDatamartWire, decode injected):
  // two tasks sampling the same message bytes await ONE in-flight decode —
  // the per-message promise cache behind the pooled async path.
  const message = makeJ2kGrib();
  let decodes = 0;
  const decodeJ2k = (codestream: Uint8Array): J2kSamples => {
    decodes += 1;
    expect(Array.from(codestream)).toEqual([0x11, 0x22, 0x33, 0x44]); // section 7 payload
    return {
      values: new Int32Array(88).fill(7),
      bitsPerSample: 8,
      isSigned: false,
      componentCount: 1,
    };
  };
  const wire = liveDatamartWire({ decodeJ2k });
  try {
    const [first, second] = await Promise.all([
      wire.sampleSites(message, [DUNDEE]), // no distance cap — this feed's posture
      wire.sampleSites(message, [DUNDEE]),
    ]);
    expect(decodes).toBe(1);
    expect(first).toEqual({ dundee: 7.0 });
    expect(second).toEqual(first);
  } finally {
    await wire.close?.(); // no pool booted (decode injected) — a no-op, but the manners hold
  }
});

it("surface and pressure tables carry the ported conversions", () => {
  expect(SURFACE_FIELDS["precipitationMm"]![0]).toBe("PRATE_SFC_0");
  expect(SURFACE_FIELDS["precipitationMm"]![1](0.001)).toBeCloseTo(3.6, 12); // ×3600
  expect(SURFACE_FIELDS["seaLevelPressureHpa"]![1](101300.0)).toBe(1013.0); // Pa → hPa
  expect(SURFACE_FIELDS["temperatureC"]![1](293.15)).toBeCloseTo(20.0, 9); // K → °C
  expect(PRESSURE_FIELDS["temperatureC"]![1](283.15)).toBeCloseTo(10.0, 9);
  expect(Object.keys(PRESSURE_FIELDS)).toEqual([
    "dewPointDepressionC",
    "heightM",
    "temperatureC",
    "windDirectionDeg",
    "windSpeedMps",
  ]); // no omega on this feed
});

describe("the pinned referenceTime", () => {
  it("resolves a valid cycle stamp", () => {
    expect(pinnedRun("2026-08-08T12:00:00Z")).toEqual({ date: "20260808", hour: "12" });
  });

  it("rejects non-cycle stamps", () => {
    expect(() => pinnedRun("2026-08-08T06:00:00Z")).toThrow(/not an hrdps-west cycle/);
    expect(() => pinnedRun("20260808T12Z")).toThrow(/cycle stamp/);
  });
});
