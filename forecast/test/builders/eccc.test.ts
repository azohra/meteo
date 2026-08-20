import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  nearestGridpoint,
  parseFields,
  parseGrid,
  type J2kSamples,
  type J2kScaling,
} from "@azohra/meteo.grib";
import { packagedModelsPath } from "../../src/catalogue.js";
import { NotFoundError } from "../../src/providers/datamart.js";
import { DownloadCounters } from "../../src/providers/transport.js";
import type { Site } from "../../src/sites.js";
import {
  GDPS,
  GDPS_INTERMEDIATE_LEVELS,
  HRDPS,
  PRESSURE_LEVELS,
  RDPS,
  buildEccc,
  buildProfiles,
  englishPressureVariable,
  fileUrl,
  gdpsCapeHours,
  gdpsLevels,
  modelSemantics,
  oldStylePressureVariable,
  pinnedRun,
  precipRateForHour,
  previousScheduledHour,
  type DatamartModel,
} from "../../src/builders/eccc.js";
import {
  FETCH_CONCURRENCY,
  resetGridPointsCache,
  sampleDatamartField,
  type DatamartWire,
} from "../../src/providers/datamart.js";
import { SEMANTICS as HRDPS_WEST_SEMANTICS } from "../../src/builders/hrdps-west.js";
import { FETCH_CONCURRENCY as RAQDPS_FETCH_CONCURRENCY } from "../../src/builders/raqdps.js";
import { splitMembers } from "../../src/history.js";
import { stubFetch, useCleanWireEnv } from "../helpers/wire.js";

useCleanWireEnv();
beforeEach(() => resetGridPointsCache());

const DUNDEE: Site = {
  slug: "dundee",
  name: "Dundee",
  latitude: 49.291977,
  longitude: -117.183569,
  timeZone: "America/Vancouver",
};
const ERIE: Site = {
  slug: "erie",
  name: "Erie",
  latitude: 49.204789,
  longitude: -117.406951,
  timeZone: "America/Vancouver",
};

// RDPS's rotated pole.
const RDPS_POLE: [number, number] = [-31.758312, 267.597031];

const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
  models: Array<{ slug: string; capabilities: Record<string, unknown> }>;
  smokeModels: Array<Record<string, unknown>>;
};

/* --- Synthetic GRIB2 messages, byte by byte (trimmed from
 * grib/test/helpers/synthetic.ts — copied, per the shared-harness rule).
 * One constant-valued 11×8, 0.1° grid around the catalogued sites; a
 * rotated variant places the same window in rotated coordinates; a bitmap
 * masks gridpoints the way real fields encode missing data. Constant
 * fields pack as DRT 5.0 with bitsPerValue 0 — ecCodes' documented
 * special case — so no JPEG 2000 decoder is involved. --- */

function u16be(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
function i16sm(value: number): number[] {
  const magnitude = Math.abs(value);
  return [((value < 0 ? 0x80 : 0) | (magnitude >> 8)) & 0xff, magnitude & 0xff];
}
function f32be(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, false);
  return [...bytes];
}
function section(number: number, body: number[]): number[] {
  return [...u32be(body.length + 5), number, ...body];
}
function microSigned(degrees: number): number[] {
  const bytes = u32be(Math.round(Math.abs(degrees) * 1e6));
  if (degrees < 0) bytes[0] = bytes[0]! | 0x80;
  return bytes;
}
function microUnsigned(degrees: number): number[] {
  return u32be(Math.round((((degrees % 360) + 360) % 360) * 1e6));
}

interface MakeGribOptions {
  rotatedPole?: [latitude: number, longitude: number];
  firstLat?: number;
  firstLon?: number;
  missingIndexes?: readonly number[];
  /** Pack as DRT 5.40 so the injected JPEG 2000 decode seam fires; the
   * 4-byte section 7 payload stands in for a codestream. */
  jpeg2000?: boolean;
}

function makeGrib(value: number, options: MakeGribOptions = {}): Uint8Array {
  const ni = 11;
  const nj = 8;
  const firstLat = options.firstLat ?? 49.6;
  const firstLon = options.firstLon ?? 242.0;
  const missing = new Set(options.missingIndexes ?? []);
  const rotated = options.rotatedPole !== undefined;

  const section1 = section(1, [
    ...u16be(54),
    ...u16be(0),
    28, // tables version
    0,
    1, // significance: start of forecast
    ...u16be(2026),
    8,
    8,
    0,
    0,
    0,
    0, // production status
    1, // type of data: forecast
  ]);
  const grid = [
    0, // source of grid definition
    ...u32be(ni * nj),
    0,
    0,
    ...u16be(rotated ? 1 : 0), // template 3.0 / 3.1
    6, // spherical earth 6 371 229 m
    0,
    ...u32be(0),
    0,
    ...u32be(0),
    0,
    ...u32be(0),
    ...u32be(ni),
    ...u32be(nj),
    ...u32be(0),
    ...u32be(0),
    ...microSigned(firstLat),
    ...microUnsigned(firstLon),
    0x30, // increments given, earth-relative winds
    ...microSigned(firstLat - (nj - 1) * 0.1),
    ...microUnsigned(firstLon + (ni - 1) * 0.1),
    ...u32be(Math.round(0.1 * 1e6)),
    ...u32be(Math.round(0.1 * 1e6)),
    0, // scanning mode: i+, j-
  ];
  if (rotated) {
    grid.push(
      ...microSigned(options.rotatedPole![0]),
      ...microUnsigned(options.rotatedPole![1]),
      ...f32be(0),
    );
  }
  const section3 = section(3, grid);
  const section4 = section(4, [
    ...u16be(0),
    ...u16be(0), // template 4.0
    0,
    0, // parameter category/number
    2,
    255,
    255,
    ...u16be(0),
    0,
    1, // unit: hours
    ...u32be(1),
    103,
    0,
    ...u32be(10),
    255,
    255,
    ...u32be(0xffffffff),
  ]);
  const section5 = options.jpeg2000
    ? section(5, [
        ...u32be(ni * nj - missing.size),
        ...u16be(40), // DRT 5.40: JPEG 2000
        ...f32be(0), // reference 0, scales 0: value = the raw sample
        ...i16sm(0),
        ...i16sm(0),
        8, // bitsPerValue nonzero: the codestream decoder must run
        0, // original field type
        0, // compression type: lossless
        255, // target compression ratio: missing
      ])
    : section(5, [
        ...u32be(ni * nj - missing.size),
        ...u16be(0), // DRT 5.0
        ...f32be(value), // reference value: the constant field
        ...i16sm(0),
        ...i16sm(0),
        0, // bitsPerValue 0: every point is the reference value
        0,
      ]);
  let section6: number[];
  if (missing.size === 0) {
    section6 = section(6, [255]);
  } else {
    const bits: number[] = [];
    for (let index = 0; index < ni * nj; index += 1) {
      bits.push(missing.has(index) ? 0 : 1);
    }
    const bytes: number[] = [];
    for (let index = 0; index < bits.length; index += 8) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        byte = (byte << 1) | (bits[index + bit] ?? 0);
      }
      bytes.push(byte);
    }
    section6 = section(6, [0, ...bytes]);
  }
  const section7 = section(7, options.jpeg2000 ? [0x11, 0x22, 0x33, 0x44] : []);
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
    ...u32be(0),
    ...u32be(total),
    ...body,
    0x37,
    0x37,
    0x37,
    0x37,
  ]);
}

function gridIndexOf(message: Uint8Array, latitude: number, longitude: number): number {
  const [field] = parseFields(message);
  return nearestGridpoint(parseGrid(field!.section3), latitude, longitude).index;
}

it("file URLs match the Datamart layout", () => {
  expect(fileUrl(HRDPS, "20260807", "00", 24, "TMP_ISBL_1015")).toBe(
    "https://dd.weather.gc.ca/20260807/WXO-DD/model_hrdps/continental/2.5km/00/024/" +
      "20260807T00Z_MSC_HRDPS_TMP_ISBL_1015_RLatLon0.0225_PT024H.grib2",
  );
  expect(fileUrl(RDPS, "20260807", "00", 84, "AirTemp_AGL-2m")).toBe(
    "https://dd.weather.gc.ca/20260807/WXO-DD/model_rdps/10km/00/084/" +
      "20260807T00Z_MSC_RDPS_AirTemp_AGL-2m_RLatLon0.09_PT084H.grib2",
  );
  expect(fileUrl(GDPS, "20260807", "12", 240, "Precip-Accum_Sfc")).toBe(
    "https://dd.weather.gc.ca/20260807/WXO-DD/model_gdps/15km/12/240/" +
      "20260807T12Z_MSC_GDPS_Precip-Accum_Sfc_LatLon0.15_PT240H.grib2",
  );
  // Terrain lives at PT000 only (RDPS/GDPS) — hour 0 must format cleanly.
  expect(fileUrl(GDPS, "20260807", "00", 0, "GeopotentialHeight_Sfc")).toMatch(
    /\/000\/20260807T00Z_MSC_GDPS_GeopotentialHeight_Sfc_LatLon0\.15_PT000H\.grib2$/,
  );
});

it("file URLs honour the Datamart base override", () => {
  // hpfx serves the identical dated tree, so only the host changes; a
  // trailing slash in the override must not double up.
  process.env["METEO_DATAMART_BASE"] = "https://hpfx.collab.science.gc.ca/";
  expect(fileUrl(HRDPS, "20260807", "00", 24, "TMP_ISBL_1015")).toBe(
    "https://hpfx.collab.science.gc.ca/20260807/WXO-DD/model_hrdps/continental/2.5km/" +
      "00/024/20260807T00Z_MSC_HRDPS_TMP_ISBL_1015_RLatLon0.0225_PT024H.grib2",
  );
});

it("Datamart builders share the per-host connection budget", () => {
  // One workflow job per Datamart host and sequential builders inside a
  // job make this constant the per-host connection ceiling — keep every
  // ECCC builder in this package on the same budget (the ensemble
  // builders assert theirs beside their own configs). hrdps-west runs on
  // this same engine, so it shares the budget by construction.
  expect(FETCH_CONCURRENCY).toBe(5);
  expect(RAQDPS_FETCH_CONCURRENCY).toBe(FETCH_CONCURRENCY);
});

it("pressure variable tokens cover both naming schemes", () => {
  expect(oldStylePressureVariable("temperatureC", 1015)).toBe("TMP_ISBL_1015");
  expect(oldStylePressureVariable("verticalVelocityPaS", 850)).toBe("VVEL_ISBL_0850");
  expect(englishPressureVariable("temperatureC", 850)).toBe("AirTemp_IsbL-0850");
  expect(englishPressureVariable("dewPointDepressionC", 985)).toBe("DewPointDepression_IsbL-0985");
  expect(englishPressureVariable("verticalVelocityPaS", 600)).toBe("VerticalVelocity_IsbL-0600");
});

it("model schedules cover their advertised horizons", () => {
  expect(HRDPS.forecastHours).toEqual(Array.from({ length: 48 }, (_, index) => index + 1));
  expect(RDPS.forecastHours).toEqual(Array.from({ length: 84 }, (_, index) => index + 1));
  expect(GDPS.forecastHours).toEqual(Array.from({ length: 80 }, (_, index) => (index + 1) * 3));
});

it("GDPS levels thin only on intermediate steps past 168", () => {
  expect(gdpsLevels(24)).toBe(PRESSURE_LEVELS);
  expect(gdpsLevels(168)).toBe(PRESSURE_LEVELS);
  expect(gdpsLevels(171)).toBe(GDPS_INTERMEDIATE_LEVELS); // verified live: 1015 is 404 here
  expect(gdpsLevels(174)).toBe(PRESSURE_LEVELS);
  expect(gdpsLevels(237)).toBe(GDPS_INTERMEDIATE_LEVELS);
  expect(gdpsLevels(240)).toBe(PRESSURE_LEVELS);
  expect(HRDPS.levelsForHour(48)).toBe(PRESSURE_LEVELS);
  expect(RDPS.levelsForHour(84)).toBe(PRESSURE_LEVELS);
});

it("omega levels are the curated intersections", () => {
  expect(HRDPS.omegaLevels).toEqual([1000, 850, 700]);
  expect(RDPS.omegaLevels).toEqual([850, 700]);
  expect(GDPS.omegaLevels).toEqual([850, 700, 600]);
  for (const model of [HRDPS, RDPS, GDPS]) {
    for (const level of model.omegaLevels) {
      expect(PRESSURE_LEVELS).toContain(level);
    }
  }
  // GDPS's reduced steps keep omega only where the level itself survives.
  expect(GDPS.omegaLevels.filter((level) => gdpsLevels(171).includes(level))).toEqual([850, 700]);
});

it("models.json matches the builder configurations", () => {
  const entries = new Map(catalogue.models.map((entry) => [entry.slug, entry]));
  for (const model of [HRDPS, RDPS, GDPS]) {
    const capabilities = entries.get(model.slug)!.capabilities;
    expect(capabilities["pressureLevels"]).toEqual([...PRESSURE_LEVELS]);
    // The ECCC deterministic trio publishes its own omega (Pa/s); the
    // capability is a provenance token, not a boolean.
    expect(capabilities["verticalVelocity"]).toBe("omega");
    expect(capabilities["verticalVelocityLevels"]).toEqual([...model.omegaLevels]);
    // Science-wave capabilities mirror the builder configuration exactly:
    // ECCC gusts are hour-max, CAPE everywhere, CIN only where a CIN
    // variable exists (the HRDPS family has none), PBL everywhere.
    expect(capabilities["gust"]).toBe(model.gustMaxVariable !== undefined ? "hourMax" : false);
    expect(capabilities["cape"]).toBe(model.capeVariable !== undefined);
    expect(capabilities["cin"]).toBe(model.cinVariable !== undefined);
    expect(capabilities["pblHeight"]).toBe(model.pblVariable !== undefined);
    expect(capabilities["cloudLayers"]).toBe(false); // ECCC has total cloud only
    expect(capabilities["cloudProfile"]).toBe(false);
    // The catalogue's precipitation token mirrors the transport the
    // builder actually uses — window quantities, never PRATE, here.
    expect(capabilities["precipitation"]).toBe("windowMeanRate");
    expect(modelSemantics(model)).toEqual({ gust: "hourMax", precipitation: "windowMeanRate" });
  }
  // The declared semantics mirror the catalogue for this package's other
  // Datamart profile model too — hrdps-west is the PRATE feed.
  const west = entries.get("hrdps-west")!.capabilities;
  expect(HRDPS_WEST_SEMANTICS.gust).toBe(west["gust"]);
  expect(HRDPS_WEST_SEMANTICS.precipitation).toBe(west["precipitation"]);
  expect(HRDPS_WEST_SEMANTICS.precipitation).toBe("instantRate");
});

describe("run-total precipitation differencing", () => {
  const accumulations: Record<number, Record<string, number>> = {
    0: { dundee: 0.0 },
    3: { dundee: 1.2 },
    6: { dundee: 4.2 },
  };
  const lookup = (hour: number): Record<string, number> => accumulations[hour]!;

  it("differences run totals and divides by the window", async () => {
    expect((await precipRateForHour(lookup, GDPS.forecastHours, 3))["dundee"]).toBeCloseTo(0.4, 9);
    expect((await precipRateForHour(lookup, GDPS.forecastHours, 6))["dundee"]).toBeCloseTo(1.0, 9);
  });

  it("clamps resampling noise to non-negative precipitation", async () => {
    const noisy = (hour: number): Record<string, number> =>
      ({ 3: { erie: 5.0 }, 6: { erie: 4.9 } })[hour]!;
    expect(await precipRateForHour(noisy, GDPS.forecastHours, 6)).toEqual({ erie: 0.0 });
  });

  it("the first scheduled step differences against the run start", () => {
    expect(previousScheduledHour(GDPS.forecastHours, 3)).toBe(0);
    expect(previousScheduledHour(GDPS.forecastHours, 240)).toBe(237);
    expect(previousScheduledHour([1, 2, 3], 1)).toBe(0);
  });
});

describe("Datamart GRIB sampling", () => {
  it("reads the nearest gridpoint within the guard", async () => {
    expect(await sampleDatamartField(makeGrib(42.5), [DUNDEE], 15.0)).toEqual({ dundee: 42.5 });
  });

  it("rejects gridpoints beyond the distance cap", async () => {
    await expect(sampleDatamartField(makeGrib(42.5), [DUNDEE], 0.5)).rejects.toThrow(
      /outside the model grid/,
    );
  });

  it("rejects points off the grid entirely", async () => {
    const away: Site = { ...DUNDEE, slug: "away", latitude: 40.0, longitude: -100.0 };
    await expect(sampleDatamartField(makeGrib(42.5), [away], 15.0)).rejects.toThrow(
      /outside the model grid/,
    );
  });

  it("samples every site from one decoded field", async () => {
    const samples = await sampleDatamartField(makeGrib(7.0), [DUNDEE, ERIE], 15.0);
    expect(samples).toEqual({ dundee: 7.0, erie: 7.0 });
  });

  it("concurrent samples of one message decode it exactly once", async () => {
    // Pinned mechanism: the per-message promise cache behind the pooled async path.
    const message = makeGrib(0, { jpeg2000: true });
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
    const [first, second] = await Promise.all([
      sampleDatamartField(message, [DUNDEE, ERIE], 15.0, decodeJ2k),
      sampleDatamartField(message, [DUNDEE, ERIE], 15.0, decodeJ2k),
    ]);
    expect(decodes).toBe(1);
    expect(first).toEqual({ dundee: 7.0, erie: 7.0 });
    expect(second).toEqual(first);
  });

  it("prefers the worker-side sampled seam and never decodes in full there", async () => {
    // The live wire's fast path: decodeJ2kSampled receives the exact
    // scaling coefficients and the sites' grid indexes, answers with the
    // gathered doubles, and the full-decode seam stays untouched.
    const message = makeGrib(0, { jpeg2000: true });
    let fullDecodes = 0;
    const decodeJ2k = (): J2kSamples => {
      fullDecodes += 1;
      throw new Error("full decode must not run when the sampled seam is present");
    };
    const sampledCalls: Array<{ scaling: J2kScaling; indices: number[] }> = [];
    const decodeJ2kSampled = (
      codestream: Uint8Array,
      scaling: J2kScaling,
      indices: Uint32Array,
    ): Float64Array => {
      expect(Array.from(codestream)).toEqual([0x11, 0x22, 0x33, 0x44]);
      sampledCalls.push({ scaling, indices: Array.from(indices) });
      return Float64Array.from(indices, (index) => index + 0.5);
    };
    const samples = await sampleDatamartField(
      message,
      [DUNDEE, ERIE],
      15.0,
      decodeJ2k,
      decodeJ2kSampled,
    );
    expect(fullDecodes).toBe(0);
    expect(sampledCalls).toHaveLength(1);
    // Reference 0 with zero scale factors: the identity coefficients, and
    // section 5's coded count (the full 88-point grid).
    expect(sampledCalls[0]!.scaling).toEqual({
      referenceValue: 0,
      binaryScale: 1,
      decimalScale: 1,
      expectedCount: 88,
    });
    expect(sampledCalls[0]!.indices).toHaveLength(2);
    expect(samples).toEqual({
      dundee: sampledCalls[0]!.indices[0]! + 0.5,
      erie: sampledCalls[0]!.indices[1]! + 0.5,
    });
  });

  it("bitmap-masked points stay null through the cache", async () => {
    const plain = makeGrib(5.0);
    const dundeeIndex = gridIndexOf(plain, DUNDEE.latitude, DUNDEE.longitude);
    const erieIndex = gridIndexOf(plain, ERIE.latitude, ERIE.longitude);
    expect(dundeeIndex).not.toBe(erieIndex);
    const masked = makeGrib(5.0, { missingIndexes: [dundeeIndex] });
    expect(await sampleDatamartField(masked, [DUNDEE, ERIE], 15.0)).toEqual({
      dundee: null,
      erie: 5.0,
    });
  });

  it("handles a rotated grid like RDPS", async () => {
    // The site window expressed in RDPS's rotated frame: Dundee sits near
    // (-6.0, -16.0) rotated, so a grid starting north-west of that covers it.
    const message = makeGrib(7.25, { rotatedPole: RDPS_POLE, firstLat: -5.6, firstLon: 343.5 });
    expect(await sampleDatamartField(message, [DUNDEE], 15.0)).toEqual({ dundee: 7.25 });
  });
});

const TEST_MODEL: DatamartModel = {
  slug: "test-10km",
  path: "model_test/10km",
  filePrefix: "MSC_TEST",
  gridToken: "RLatLon0.09",
  runHours: ["00"],
  forecastHours: [3, 6],
  surfaceVariables: {
    cloudCoverPercent: ["TotalCloudCover_Sfc", (v) => v],
    latentHeatFluxWm2: ["LatentHeatNetFlux_Sfc", (v) => v],
    seaLevelPressureHpa: ["Pressure_MSL", (v) => v / 100.0],
    sensibleHeatFluxWm2: ["SensibleHeatNetFlux_Sfc", (v) => v],
    windDirectionDeg: ["WindDir_AGL-10m", (v) => v],
    windSpeedMps: ["WindSpeed_AGL-10m", (v) => v],
  },
  probeVariable: "AirTemp_AGL-2m",
  temperatureVariable: "AirTemp_AGL-2m",
  dewPointVariable: "DewPoint_AGL-2m",
  pressureVariable: englishPressureVariable,
  omegaLevels: [850],
  terrainVariable: "GeopotentialHeight_Sfc",
  terrainHour: 0,
  maxNearestKm: 15.0,
  precipRunTotalVariable: "Precip-Accum_Sfc",
  levelsForHour: () => [925, 850, 700, 600],
  gustMaxVariable: "WindGust-Max_AGL-10m",
  gustInstantVariable: "WindGust_AGL-10m",
  capeVariable: "CAPE_Sfc",
  cinVariable: "CIN_Sfc",
  capeSentinel: 9999.0,
  capeForHour: () => true,
  pblVariable: "PlanetaryBoundaryLayerHeight_Sfc",
};

const LEVEL_HEIGHTS: Record<number, number> = {
  925: 1500.0,
  850: 2500.0,
  700: 4500.0,
  600: 5500.0,
};
const LEVEL_TEMPS_K: Record<number, number> = {
  925: 288.15,
  850: 283.15,
  700: 268.15,
  600: 258.15,
};

function fakeDatamart(date: string): Map<string, number> {
  const url = (variable: string, hour: number): string =>
    fileUrl(TEST_MODEL, date, "00", hour, variable);
  const store = new Map<string, number>([[url("GeopotentialHeight_Sfc", 0), 1000.0]]);
  const surface: Record<string, (hour: number) => number> = {
    "AirTemp_AGL-2m": (hour) => 293.15 + hour,
    "DewPoint_AGL-2m": (hour) => 283.15 + hour,
    "WindDir_AGL-10m": () => 246.0,
    "WindSpeed_AGL-10m": () => 1.5,
    Pressure_MSL: () => 101300.0,
    TotalCloudCover_Sfc: () => 40.0,
    SensibleHeatNetFlux_Sfc: () => 200.0,
    LatentHeatNetFlux_Sfc: () => 50.0,
    "Precip-Accum_Sfc": (hour) => ({ 3: 1.5, 6: 6.0 })[hour]!,
    // Hour-max gust always >= the instantaneous diagnostic (asserted).
    "WindGust-Max_AGL-10m": () => 9.4,
    "WindGust_AGL-10m": () => 6.1,
    // Hour 6's CAPE and hour 3's CIN carry the 9999 "not computed"
    // sentinel — those positions must vanish, not publish.
    CAPE_Sfc: (hour) => ({ 3: 850.0, 6: 9999.0 })[hour]!,
    CIN_Sfc: (hour) => ({ 3: 9999.0, 6: -55.0 })[hour]!,
  };
  // PBL height exists at hour 3 only; the absent hour-6 file is a
  // tolerated 404, so hour 6 simply publishes no pblHeightM.
  store.set(url("PlanetaryBoundaryLayerHeight_Sfc", 3), 1650.0);
  for (const hour of TEST_MODEL.forecastHours) {
    for (const [variable, value] of Object.entries(surface)) {
      store.set(url(variable, hour), value(hour));
    }
    for (const level of [925, 850, 700, 600]) {
      if (hour === 6 && level === 600) {
        continue; // the level thins out upstream: five 404s, tolerated
      }
      const suffix = `IsbL-${String(level).padStart(4, "0")}`;
      store.set(url(`AirTemp_${suffix}`, hour), LEVEL_TEMPS_K[level]!);
      store.set(url(`DewPointDepression_${suffix}`, hour), 5.0);
      store.set(url(`GeopotentialHeight_${suffix}`, hour), LEVEL_HEIGHTS[level]!);
      store.set(url(`WindDir_${suffix}`, hour), 250.0);
      store.set(url(`WindSpeed_${suffix}`, hour), 8.0);
    }
  }
  // Omega exists at 850 only, and only at hour 3 — hour 6's absence must
  // publish the level without the optional field.
  store.set(url("VerticalVelocity_IsbL-0850", 3), -0.42);
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
    sampleSites: async (message, sites) => {
      const value = store.get(new TextDecoder().decode(message))!;
      return Object.fromEntries(sites.map((site) => [site.slug, value]));
    },
  };
}

interface PublishedLevel {
  pressureHpa: number;
  heightM: number;
  temperatureC: number;
  dewPointC: number;
  verticalVelocityPaS?: number;
  [key: string]: unknown;
}

interface PublishedProfile {
  model: string;
  site: { modelElevationM: number; timeZone?: string };
  semantics: Record<string, string>;
  hours: Array<{
    validAt: string;
    surface: Record<string, number>;
    levels: PublishedLevel[];
  }>;
}

it("buildProfiles end-to-end against a fake Datamart", async () => {
  const date = "20260808";
  const result = await buildProfiles(
    TEST_MODEL,
    { date, hour: "00" },
    "2026-08-08T00:00:00Z",
    [DUNDEE],
    new DownloadCounters(),
    { wire: fakeWire(fakeDatamart(date)) },
  );

  expect(result.firstForecastHour).toBe(3);
  expect(result.lastForecastHour).toBe(6);
  expect(result.forecastHours).toBe(2);
  expect(result.profiles).toHaveLength(1);
  const profile = result.profiles[0] as unknown as PublishedProfile;
  expect(profile.model).toBe("test-10km");
  expect(profile.site.modelElevationM).toBe(1000.0);
  // The published document self-interprets its varying fields — the
  // catalogue's timezone echo included.
  expect(profile.site.timeZone).toBe("America/Vancouver");
  expect(profile.semantics).toEqual({ gust: "hourMax", precipitation: "windowMeanRate" });

  // The fake wire is exact (no packing quantization), so equality is exact.
  const [first, second] = profile.hours;
  expect(first!.validAt).toBe("2026-08-08T03:00:00Z");
  expect(first!.surface["temperatureC"]).toBeCloseTo(23.0, 9);
  expect(first!.surface["dewPointC"]).toBeCloseTo(13.0, 9);
  expect(first!.surface["windDirectionDeg"]).toBe(246.0);
  expect(first!.surface["seaLevelPressureHpa"]).toBe(1013);
  // Run totals 1.5 mm by +3 and 6.0 mm by +6 → 0.5 and 1.5 mm/h.
  expect(first!.surface["precipitationMmHr"]).toBeCloseTo(0.5, 9);
  expect(second!.surface["precipitationMmHr"]).toBeCloseTo(1.5, 9);

  expect(first!.levels.map((level) => level.pressureHpa)).toEqual([925, 850, 700, 600]);
  expect(second!.levels.map((level) => level.pressureHpa)).toEqual([925, 850, 700]);
  for (const hour of [first!, second!]) {
    for (const level of hour.levels) {
      expect(level.heightM).toBe(LEVEL_HEIGHTS[level.pressureHpa]);
      expect(level.temperatureC).toBeCloseTo(LEVEL_TEMPS_K[level.pressureHpa]! - 273.15, 9);
      expect(level.dewPointC).toBeCloseTo(level.temperatureC - 5.0, 9);
    }
  }

  // Omega is level-sparse and step-sparse: present only where a file was.
  expect(first!.levels[1]!.verticalVelocityPaS).toBeCloseTo(-0.42, 9);
  expect(second!.levels.every((level) => !("verticalVelocityPaS" in level))).toBe(true);
  expect(
    first!.levels
      .filter((level) => level.pressureHpa !== 850)
      .every((level) => !("verticalVelocityPaS" in level)),
  ).toBe(true);

  for (const hour of [first!, second!]) {
    for (const value of Object.values(hour.surface)) {
      if (typeof value === "number") {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  }

  // Science fields: hour-max gust published, sentinels masked to absence,
  // PBL only where the file existed.
  expect(first!.surface["windGustMps"]).toBe(9.4);
  expect(second!.surface["windGustMps"]).toBe(9.4);
  expect(first!.surface["capeJkg"]).toBe(850.0);
  expect(first!.surface).not.toHaveProperty("cinJkg"); // 9999 sentinel masked
  expect(second!.surface).not.toHaveProperty("capeJkg"); // 9999 sentinel masked
  expect(second!.surface["cinJkg"]).toBe(-55.0);
  expect(first!.surface["pblHeightM"]).toBe(1650.0);
  expect(second!.surface).not.toHaveProperty("pblHeightM"); // tolerated 404
});

it("the build fails loudly when gust semantics break", async () => {
  // The Max files' interval metadata is broken upstream, so the hourly
  // window semantics are re-asserted every build: Max < instant beyond
  // packing noise means the files no longer mean what was verified.
  const date = "20260808";
  const store = fakeDatamart(date);
  for (const hour of TEST_MODEL.forecastHours) {
    store.set(fileUrl(TEST_MODEL, date, "00", hour, "WindGust-Max_AGL-10m"), 3.0);
  }

  await expect(
    buildProfiles(
      TEST_MODEL,
      { date, hour: "00" },
      "2026-08-08T00:00:00Z",
      [DUNDEE],
      new DownloadCounters(),
      { wire: fakeWire(store) },
    ),
  ).rejects.toThrow(/Gust semantics broke/);
});

it("GDPS CAPE thins one regime earlier than the other fields", () => {
  // Live behaviour: CAPE/CIN present at 003/024/174/240, absent at 001
  // (hourly regime) and 171 (3-hourly non-6-hourly past 168).
  expect(gdpsCapeHours(3)).toBe(true);
  expect(gdpsCapeHours(168)).toBe(true);
  expect(gdpsCapeHours(171)).toBe(false);
  expect(gdpsCapeHours(174)).toBe(true);
  expect(gdpsCapeHours(240)).toBe(true);
  // Gusts and PBL follow the broader schedule, not the CAPE one.
  expect(GDPS.capeForHour).toBe(gdpsCapeHours);
  expect(HRDPS.capeForHour(47)).toBe(true);
  expect(RDPS.capeForHour(84)).toBe(true);
});

describe("the pinned referenceTime", () => {
  it("resolves a valid cycle stamp to its tree coordinates", () => {
    expect(pinnedRun(RDPS, "2026-08-07T06:00:00Z")).toEqual({ date: "20260807", hour: "06" });
    expect(pinnedRun(GDPS, "2026-08-07T12:00:00Z")).toEqual({ date: "20260807", hour: "12" });
  });

  it("rejects a stamp that is not a model cycle", () => {
    expect(() => pinnedRun(GDPS, "2026-08-07T06:00:00Z")).toThrow(/not a gdps cycle/);
    expect(() => pinnedRun(RDPS, "20260807T06Z")).toThrow(/not a rdps cycle stamp/);
    expect(() => pinnedRun(RDPS, "2026-08-07T05:00:00Z")).toThrow(/not a rdps cycle/);
  });
});

describe("buildEccc", () => {
  let scratch: string | undefined;
  afterEach(() => {
    if (scratch !== undefined) {
      rmSync(scratch, { recursive: true, force: true });
      scratch = undefined;
    }
  });

  function writeSites(directory: string): string {
    const path = join(directory, "sites.json");
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 2,
        sites: [
          {
            slug: DUNDEE.slug,
            name: DUNDEE.name,
            latitude: DUNDEE.latitude,
            longitude: DUNDEE.longitude,
            timeZone: DUNDEE.timeZone,
          },
        ],
      }),
    );
    return path;
  }

  it("skips a run the dataset already publishes", async () => {
    scratch = mkdtempSync(join(tmpdir(), "eccc-test-"));
    const sitesPath = writeSites(scratch);
    const manifest = { model: "test-10km", referenceTime: "2026-08-08T00:00:00Z" };
    const dataset = stubFetch([{ status: 200, body: JSON.stringify(manifest) }]);
    const lines: string[] = [];

    const built = await buildEccc(TEST_MODEL, {
      sitesPath,
      outputRoot: join(scratch, "data"),
      referenceTime: "2026-08-08T00:00:00Z",
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(fakeDatamart("20260808")),
      log: (line) => lines.push(line),
    });

    expect(built).toBe(false);
    expect(lines).toEqual(["test-10km run 2026-08-08T00:00:00Z is already published."]);
  });

  it("publishes the tree: rounded site documents, history archive, manifest", async () => {
    scratch = mkdtempSync(join(tmpdir(), "eccc-test-"));
    const sitesPath = writeSites(scratch);
    const outputRoot = join(scratch, "data");
    // The empty published dataset: the manifest gate reads 404, then the
    // history seed for the site's month reads 404.
    const dataset = stubFetch([{ status: 404 }, { status: 404 }]);

    const built = await buildEccc(TEST_MODEL, {
      sitesPath,
      outputRoot,
      referenceTime: "2026-08-08T00:00:00Z",
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(fakeDatamart("20260808")),
      generatedAt: () => "2026-08-08T04:30:00Z",
      log: () => {},
    });

    expect(built).toBe(true);
    const document = JSON.parse(
      readFileSync(join(outputRoot, "test-10km", "sites", "dundee.json"), "utf-8"),
    ) as {
      schemaVersion: number;
      model: string;
      run: { referenceTime: string; generatedAt: string };
      site: { id: string; modelElevationM: number };
      hours: Array<{ surface: { seaLevelPressureHpa: number; precipitationMmHr: number } }>;
    };
    expect(document.schemaVersion).toBe(2); // the v2 site-forecast document
    expect(document.model).toBe("test-10km");
    expect(document.run).toEqual({
      referenceTime: "2026-08-08T00:00:00Z",
      generatedAt: "2026-08-08T04:30:00Z",
    });
    expect(document.site.modelElevationM).toBe(1000);
    expect(document.hours).toHaveLength(2);
    // Pressure_MSL 101300 Pa → 1013 hPa, rounded per the contract table.
    expect(document.hours[0]!.surface.seaLevelPressureHpa).toBe(1013);
    expect(document.hours[0]!.surface.precipitationMmHr).toBe(0.5);

    const manifest = JSON.parse(
      readFileSync(join(outputRoot, "test-10km", "manifest.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(manifest["firstForecastHour"]).toBe(3);
    expect(manifest["forecastHours"]).toBe(2);
    expect(manifest["lastForecastHour"]).toBe(6);
    expect(manifest["referenceTime"]).toBe("2026-08-08T00:00:00Z");
    expect(manifest["schemaVersion"]).toBe(1); // the manifest document version
    expect(manifest["sites"]).toEqual([{ name: "Dundee", slug: "dundee" }]);

    // One run appended as one independent gzip member, one JSON line —
    // and the line IS the site document.
    const archive = readFileSync(
      join(outputRoot, "test-10km", "history", "dundee", "2026-08.jsonl.gz"),
    );
    const members = splitMembers(archive);
    expect(members).toHaveLength(1);
    expect(members[0]!.lines).toHaveLength(1);
    expect(JSON.parse(members[0]!.lines[0]!)).toEqual(document);
  });
});
