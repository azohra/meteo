import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { J2kSamples } from "@azohra/meteo.grib";
import { packagedModelsPath } from "../../src/catalogue.js";
import { DownloadCounters } from "../../src/providers/transport.js";
import { splitMembers } from "../../src/history.js";
import type { Site } from "../../src/sites.js";
import { liveDatamartWire, type DatamartWire } from "../../src/builders/eccc.js";
import {
  FETCH_CONCURRENCY,
  FORECAST_HOURS,
  MAX_NEAREST_KM,
  RUN_HOURS,
  SLUG,
  SMOKE_FIELDS,
  buildDocuments,
  buildRaqdps,
  fileUrl,
  pinnedRun,
} from "../../src/builders/raqdps.js";
import { stubFetch, useCleanWireEnv } from "../helpers/wire.js";

useCleanWireEnv();

const SITE: Site = {
  slug: "dundee",
  name: "Dundee",
  latitude: 49.1,
  longitude: -122.2,
  timeZone: "America/Vancouver",
};

// Live-verified SI base units (kg/m³, kg/m²) in, contract units (µg/m³,
// mg/m²) out — see the SMOKE_FIELDS comment in the builder.
const RAW_VALUES: Record<string, number> = {
  "PM2.5_Sfc": 2.5e-8,
  "PM2.5-WildfireSmokePlume_Sfc": 1.5e-8,
  "PM2.5-WildfireSmokePlume_EAtm": 5.0e-6,
};

it("models.json matches the RAQDPS builder configuration", () => {
  const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
    smokeModels: Array<Record<string, unknown>>;
  };
  expect(catalogue.smokeModels).toHaveLength(1);
  const entry = catalogue.smokeModels[0]!;

  expect(entry["slug"]).toBe("raqdps");
  expect(entry["kind"]).toBe("deterministic");
  expect(entry["stepHours"]).toBe(1);
  expect(entry["horizonHours"]).toBe(FORECAST_HOURS);
  expect(FORECAST_HOURS).toBe(72);
  // Two runs a day, probed newest-first like the other ECCC builders.
  expect(entry["runIntervalHours"]).toBe(12);
  expect(RUN_HOURS).toEqual(["12", "00"]);
  expect(FETCH_CONCURRENCY).toBe(5); // the shared per-host Datamart budget
  expect(MAX_NEAREST_KM).toBe(15.0);
});

it("file URLs match the Datamart layout", () => {
  // Verified live 2026-08-09: the wildfire products are folded into the
  // plain model_raqdps tree (no model_raqdps-fw directory exists).
  expect(fileUrl("20260809", "12", 6, "PM2.5-WildfireSmokePlume_Sfc")).toBe(
    "https://dd.weather.gc.ca/20260809/WXO-DD/model_raqdps/10km/grib2/12/006/" +
      "20260809T12Z_MSC_RAQDPS_PM2.5-WildfireSmokePlume_Sfc_RLatLon0.09_PT006H.grib2",
  );
});

/** The fake fetch returns the URL's bytes; the sampler looks the value up
 * from the variable token inside it (Python's _FakeField, same idea). */
function fakeWire(overrides: Partial<Record<string, number>> = {}): DatamartWire {
  return {
    fetchBytes: async (url) => new TextEncoder().encode(url),
    sampleSites: async (message, sites, maxDistanceKm) => {
      expect(maxDistanceKm).toBe(MAX_NEAREST_KM);
      const url = new TextDecoder().decode(message);
      for (const [variable, value] of [
        ...Object.entries(overrides),
        ...Object.entries(RAW_VALUES),
      ]) {
        if (url.includes(`_${variable}_`)) {
          return Object.fromEntries(sites.map((site) => [site.slug, value ?? null]));
        }
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  };
}

it("buildDocuments publishes the converted smoke series", async () => {
  const result = await buildDocuments(
    { date: "20260809", hour: "12" },
    "2026-08-09T12:00:00Z",
    [SITE],
    new DownloadCounters(),
    { maxSteps: 2, wire: fakeWire(), generatedAt: () => "2026-08-09T17:12:00Z" },
  );

  expect(result.firstForecastHour).toBe(1);
  expect(result.forecastHours).toBe(2);
  expect(result.lastForecastHour).toBe(2);
  expect(result.documents).toHaveLength(1);
  const document = result.documents[0]!;
  expect(document.schemaVersion).toBe(1); // the smoke document, not the v2 profile
  expect(document.model).toBe("raqdps");
  expect(document.run).toEqual({
    referenceTime: "2026-08-09T12:00:00Z",
    generatedAt: "2026-08-09T17:12:00Z",
  });
  // The site block carries identity and the timezone echo — no elevations:
  // terrain is a profile concern, not an air-quality one.
  expect(document.site).toEqual({
    id: "dundee",
    name: "Dundee",
    latitude: 49.1,
    longitude: -122.2,
    timeZone: "America/Vancouver",
  });
  const [first, second] = document.hours;
  expect([first!["validAt"], second!["validAt"]]).toEqual([
    "2026-08-09T13:00:00Z",
    "2026-08-09T14:00:00Z",
  ]);
  expect(first!["pm25Ugm3"]).toBeCloseTo(25.0, 9); // 2.5e-8 kg/m³ → µg/m³
  expect(first!["smokePlumeSurfaceUgm3"]).toBeCloseTo(15.0, 9);
  expect(first!["smokePlumeColumnMgm2"]).toBeCloseTo(5.0, 9); // 5e-6 kg/m² → mg/m²
  // Field order in the published hour is the SMOKE_FIELDS declaration
  // order — byte-stable output.
  expect(Object.keys(first!)).toEqual(["validAt", ...Object.keys(SMOKE_FIELDS)]);
});

it("clamps packing noise to non-negative concentrations", async () => {
  // Concentrations are non-negative by definition; GRIB packing noise can
  // dip a clean field a hair below zero.
  const result = await buildDocuments(
    { date: "20260809", hour: "12" },
    "2026-08-09T12:00:00Z",
    [SITE],
    new DownloadCounters(),
    { maxSteps: 1, wire: fakeWire({ "PM2.5_Sfc": -1.0e-12 }) },
  );
  expect(result.documents[0]!.hours[0]!["pm25Ugm3"]).toBe(0.0);
});

it("a missing or non-finite sample kills the build", async () => {
  await expect(
    buildDocuments(
      { date: "20260809", hour: "12" },
      "2026-08-09T12:00:00Z",
      [SITE],
      new DownloadCounters(),
      { maxSteps: 1, wire: fakeWire({ "PM2.5_Sfc": undefined }) },
    ),
  ).rejects.toThrow(/Datamart returned no pm25Ugm3 for Dundee/);
});

/* --- The decode-once rule through this builder's live wire. ---
 *
 * A minimal synthetic DRT 5.40 GRIB2 message (trimmed from eccc.test.ts's
 * builder — copied, per the shared-harness rule): an 11×8, 0.1° grid
 * around the fixture site whose 4-byte section 7 payload stands in for a
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
  const firstLat = 49.3; // the grid window covers the fixture site (49.1, 237.8°E)
  const firstLon = 237.5;
  const section1 = jsection(1, [
    ...ju16(54),
    ...ju16(0),
    28,
    0,
    1,
    ...ju16(2026),
    8,
    9,
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
      wire.sampleSites(message, [SITE], MAX_NEAREST_KM),
      wire.sampleSites(message, [SITE], MAX_NEAREST_KM),
    ]);
    expect(decodes).toBe(1);
    expect(first).toEqual({ dundee: 7.0 });
    expect(second).toEqual(first);
  } finally {
    await wire.close?.(); // no pool booted (decode injected) — a no-op, but the manners hold
  }
});

describe("buildRaqdps", () => {
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
            slug: SITE.slug,
            name: SITE.name,
            latitude: SITE.latitude,
            longitude: SITE.longitude,
            timeZone: SITE.timeZone,
          },
        ],
      }),
    );
    return path;
  }

  it("publishes the tree: smoke documents, history archive, manifest", async () => {
    scratch = mkdtempSync(join(tmpdir(), "raqdps-test-"));
    const sitesPath = writeSites(scratch);
    const outputRoot = join(scratch, "data");
    // The empty published dataset: the manifest gate reads 404, then the
    // history seed for the site's month reads 404 — absence, not fatality.
    const dataset = stubFetch([{ status: 404 }, { status: 404 }]);

    const built = await buildRaqdps({
      sitesPath,
      outputRoot,
      referenceTime: "2026-08-09T12:00:00Z",
      maxSteps: 2,
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(),
      generatedAt: () => "2026-08-09T17:12:00Z",
      log: () => {},
    });

    expect(built).toBe(true);
    const document = JSON.parse(
      readFileSync(join(outputRoot, SLUG, "sites", "dundee.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(document["schemaVersion"]).toBe(1);
    expect(document["model"]).toBe(SLUG);

    const manifest = JSON.parse(
      readFileSync(join(outputRoot, SLUG, "manifest.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(manifest["firstForecastHour"]).toBe(1);
    expect(manifest["forecastHours"]).toBe(2);
    expect(manifest["lastForecastHour"]).toBe(2);
    expect(manifest["model"]).toBe(SLUG);
    expect(manifest["referenceTime"]).toBe("2026-08-09T12:00:00Z");
    expect(manifest["schemaVersion"]).toBe(1);

    // One run appended as one independent gzip member, one JSON line —
    // and the line IS the smoke document.
    const archive = readFileSync(join(outputRoot, SLUG, "history", "dundee", "2026-08.jsonl.gz"));
    const members = splitMembers(archive);
    expect(members).toHaveLength(1);
    expect(members[0]!.lines).toHaveLength(1);
    expect(JSON.parse(members[0]!.lines[0]!)).toEqual(document);
  });

  it("skips a run the dataset already publishes", async () => {
    scratch = mkdtempSync(join(tmpdir(), "raqdps-test-"));
    const sitesPath = writeSites(scratch);
    const manifest = { model: SLUG, referenceTime: "2026-08-09T12:00:00Z" };
    const dataset = stubFetch([{ status: 200, body: JSON.stringify(manifest) }]);
    const lines: string[] = [];

    const built = await buildRaqdps({
      sitesPath,
      outputRoot: join(scratch, "data"),
      referenceTime: "2026-08-09T12:00:00Z",
      dataset: { fetch: dataset.fetch },
      wire: fakeWire(),
      log: (line) => lines.push(line),
    });

    expect(built).toBe(false);
    expect(lines).toEqual(["RAQDPS run 2026-08-09T12:00:00Z is already published."]);
  });
});

describe("the pinned referenceTime", () => {
  it("resolves a valid cycle stamp", () => {
    expect(pinnedRun("2026-08-09T00:00:00Z")).toEqual({ date: "20260809", hour: "00" });
  });

  it("rejects non-cycle stamps", () => {
    expect(() => pinnedRun("2026-08-09T06:00:00Z")).toThrow(/not a raqdps cycle/);
    expect(() => pinnedRun("garbage")).toThrow(/cycle stamp/);
  });
});
