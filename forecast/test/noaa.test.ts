import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";
import { byteRange, decodeFieldValues, nearestGridpoint, parseFields } from "@azohra/meteo.grib";
import {
  fetchIndex,
  fetchRecord,
  resetGridPointsCache,
  sampleSites,
  sampleSitesUv,
  windFromUv,
  type NearestLookup,
  type SampleSite,
} from "../src/providers/noaa.js";
import { DownloadCounters } from "../src/providers/transport.js";
import { noSleep, stubFetch } from "./helpers/wire.js";

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../grib/test/fixtures/${name}`, import.meta.url))),
  );

const expectation = (name: string): Record<string, never> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../grib/test/fixtures/${name}.expect.json`, import.meta.url)),
      "utf-8",
    ),
  );

const catalogueSites = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../grib/test/fixtures/sites.json", import.meta.url)),
      "utf-8",
    ),
  ) as { sites: SampleSite[] }
).sites;

beforeEach(() => {
  resetGridPointsCache();
});

describe("windFromUv", () => {
  it.each([
    [0, -5, 5, 0],
    [-5, 0, 5, 90],
    [0, 5, 5, 180],
    [5, 0, 5, 270],
  ])("uses the meteorological FROM convention (u=%d, v=%d)", (u, v, speed, direction) => {
    expect(windFromUv(u, v)).toEqual([speed, direction]);
  });

  it("matches the hand-checked diagonal", () => {
    const [speed, direction] = windFromUv(3, 4);
    expect(speed).toBe(5);
    expect(direction).toBeCloseTo(216.87, 2);
  });
});

/* A hand-built GRIB2 lat-lon grid: 16 rows x 31 columns spanning 60..30N,
 * 0..60E at 2-degree spacing; DRT 5.0 with bitsPerValue=0 decodes every
 * present point to the reference value. */

const NI = 31;
const NJ = 16;

function u16be(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function f32be(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, false);
  return [...bytes];
}

function section(number: number, body: number[]): number[] {
  return [...u32be(body.length + 5), number, ...body];
}

function section1(): number[] {
  return section(1, [
    ...u16be(7), // centre (NCEP)
    ...u16be(0),
    28,
    0,
    1, // start of forecast
    ...u16be(2026),
    8,
    7,
    12,
    0,
    0,
    0,
    1,
  ]);
}

/** Template 3.0, sphere 6 371 229 m, scanning mode 0 (i+, j-). */
function section3(): number[] {
  const micro = (degrees: number): number[] => u32be(Math.round(degrees * 1e6));
  return section(3, [
    0,
    ...u32be(NI * NJ),
    0,
    0,
    ...u16be(0), // template 3.0
    6, // spherical earth, 6 371 229 m
    0,
    ...u32be(0),
    0,
    ...u32be(0),
    0,
    ...u32be(0),
    ...u32be(NI),
    ...u32be(NJ),
    ...u32be(0),
    ...u32be(0),
    ...micro(60), // la1
    ...micro(0), // lo1
    0x30,
    ...micro(30), // la2
    ...micro(60), // lo2
    ...micro(2), // di
    ...micro(2), // dj
    0, // scanning mode
  ]);
}

/** Template 4.0; parameterCategory/Number name U (2/2) and V (2/3). */
function section4(parameterCategory: number, parameterNumber: number): number[] {
  return section(4, [
    ...u16be(0),
    ...u16be(0),
    parameterCategory,
    parameterNumber,
    2,
    255,
    255,
    ...u16be(0),
    0,
    1,
    ...u32be(0),
    103,
    0,
    ...u32be(10),
    255,
    255,
    ...u32be(0xffffffff),
  ]);
}

/** DRT 5.0 with bitsPerValue=0: every present point decodes to `value`. */
function section5Constant(value: number, presentPoints: number): number[] {
  return section(5, [
    ...u32be(presentPoints),
    ...u16be(0),
    ...f32be(value),
    0,
    0, // binary scale factor
    0,
    0, // decimal scale factor
    0, // bits per value: constant field
    0,
  ]);
}

/** No bitmap (255), or one bit per grid point (indicator 0). */
function section6(bitmap?: number[]): number[] {
  if (bitmap === undefined) return section(6, [255]);
  const bytes: number[] = [];
  for (let index = 0; index < bitmap.length; index += 8) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      byte = (byte << 1) | (bitmap[index + bit] ?? 0);
    }
    bytes.push(byte);
  }
  return section(6, [0, ...bytes]);
}

function message(...sections: number[][]): Uint8Array {
  const body = sections.flat();
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

function constantMessage(value: number): Uint8Array {
  return message(
    section1(),
    section3(),
    section4(0, 0),
    section5Constant(value, NI * NJ),
    section6(),
    section(7, []),
  );
}

const SITES: SampleSite[] = [
  { slug: "a", name: "A", latitude: 48.1, longitude: 10.1 },
  { slug: "b", name: "B", latitude: 30.0, longitude: 20.0 },
];

describe("sampleSites (synthetic)", () => {
  it("samples every site's nearest gridpoint, keyed by slug", () => {
    const samples = sampleSites(constantMessage(1.5), SITES, 1000);

    expect(Object.keys(samples)).toEqual(["a", "b"]);
    expect(samples["a"]!.value).toBe(1.5);
    expect(samples["b"]!.value).toBe(1.5);
    expect(samples["b"]!.latitude).toBe(30);
    expect(samples["b"]!.longitude).toBe(20);
    expect(samples["b"]!.distanceKm).toBeCloseTo(0, 6);
  });

  it("resolves the grid index once per grid", () => {
    const searches: Array<[number, number]> = [];
    const counting: NearestLookup = (grid, latitude, longitude) => {
      searches.push([latitude, longitude]);
      return nearestGridpoint(grid, latitude, longitude);
    };

    const first = sampleSites(constantMessage(1.0), SITES, 1000, { nearest: counting });
    const second = sampleSites(constantMessage(2.0), SITES, 1000, { nearest: counting });

    expect(new Set(Object.values(first).map((point) => point.value))).toEqual(new Set([1.0]));
    expect(new Set(Object.values(second).map((point) => point.value))).toEqual(new Set([2.0]));
    expect(searches).toHaveLength(SITES.length);
    expect(first["a"]!.distanceKm).toBe(second["a"]!.distanceKm);
  });

  it("still rejects sites far from any gridpoint", () => {
    const sites = [{ slug: "a", name: "A", latitude: 47.0, longitude: 11.0 }];

    expect(() => sampleSites(constantMessage(1.0), sites, 1)).toThrow(/outside the model grid/);
  });

  it("publishes a bitmap-masked gridpoint as absence, never a value", () => {
    // Site a's nearest gridpoint is (48N, 10E): row 6, column 5 → 191.
    const maskedIndex = 6 * NI + 5;
    const bitmap = Array.from({ length: NI * NJ }, (_bit, index) =>
      index === maskedIndex ? 0 : 1,
    );
    const masked = message(
      section1(),
      section3(),
      section4(0, 0),
      section5Constant(7.5, NI * NJ - 1),
      section6(bitmap),
      section(7, []),
    );

    const samples = sampleSites(masked, SITES, 1000);

    expect(samples["a"]!.value).toBeNull();
    expect(samples["a"]!.distanceKm).toBeGreaterThan(0);
    expect(samples["b"]!.value).toBe(7.5);
  });
});

describe("sampleSitesUv (synthetic)", () => {
  it("splits an NCEP paired-wind message into U and V by parameterNumber, not field order", () => {
    const paired = message(
      section1(),
      section3(),
      section4(2, 3),
      section5Constant(4.0, NI * NJ),
      section6(),
      section(7, []),
      section4(2, 2),
      section5Constant(3.0, NI * NJ),
      section6(),
      section(7, []),
    );

    const [u, v] = sampleSitesUv(paired, SITES, 1000);

    expect(u["a"]!.value).toBe(3.0);
    expect(v["a"]!.value).toBe(4.0);
    expect(windFromUv(u["a"]!.value!, v["a"]!.value!)[0]).toBe(5.0);
  });

  it("a message missing a component fails loudly", () => {
    const uOnly = message(
      section1(),
      section3(),
      section4(2, 2),
      section5Constant(3.0, NI * NJ),
      section6(),
      section(7, []),
    );

    expect(() => sampleSitesUv(uOnly, SITES, 1000)).toThrow(/missing a U or V component/);
  });
});

describe("sampleSites (golden GFS fixture)", () => {
  it("agrees with ecCodes' gridpoint choice and value for every catalogued site", () => {
    const bytes = fixture("gfs-tmp-850mb.grib2");
    const expected = expectation("gfs-tmp-850mb") as unknown as {
      sites: Array<{
        slug: string;
        index: number;
        latitude: number;
        longitude: number;
        distanceKm: number;
      }>;
    };
    const decoded = decodeFieldValues(parseFields(bytes)[0]!);

    const samples = sampleSites(bytes, catalogueSites, 30);

    for (const site of expected.sites) {
      const sample = samples[site.slug]!;
      expect(sample.value, site.slug).toBe(decoded.values[site.index]!);
      expect(sample.latitude, site.slug).toBeCloseTo(site.latitude, 9);
      expect(sample.longitude, site.slug).toBeCloseTo(site.longitude, 9);
      expect(Math.abs(sample.distanceKm - site.distanceKm), site.slug).toBeLessThanOrEqual(0.1);
    }
  });
});

describe("sampleSitesUv (golden NAM fixture)", () => {
  it("splits the real paired-wind message against ecCodes' expectations", () => {
    const bytes = fixture("nam-uv-10m.grib2");
    const expected = expectation("nam-uv-10m") as unknown as {
      fields: Array<{
        gridMeta: { parameterNumber: number };
        sites: Array<{ slug: string; index: number; distanceKm: number }>;
      }>;
    };
    const fields = parseFields(bytes);
    const byComponent = new Map(
      expected.fields.map((field, index) => [field.gridMeta.parameterNumber, index]),
    );

    const [u, v] = sampleSitesUv(bytes, catalogueSites, 15);

    for (const [component, samples] of [
      [2, u],
      [3, v],
    ] as const) {
      const fieldIndex = byComponent.get(component)!;
      const decoded = decodeFieldValues(fields[fieldIndex]!);
      for (const site of expected.fields[fieldIndex]!.sites) {
        const sample = samples[site.slug]!;
        expect(sample.value, `${site.slug} component ${component}`).toBe(
          decoded.values[site.index]!,
        );
        expect(Math.abs(sample.distanceKm - site.distanceKm)).toBeLessThanOrEqual(0.1);
      }
    }
  });
});

const IDX_TEXT = [
  "1:0:d=2026080712:TMP:850 mb:24 hour fcst:",
  "2:100:d=2026080712:UGRD:850 mb:24 hour fcst:",
  "3:220:d=2026080712:VGRD:850 mb:24 hour fcst:",
].join("\n");

describe("fetchIndex retry manners", () => {
  it("parses the sidecar and records the telemetry once", async () => {
    const wire = stubFetch([{ status: 200, body: IDX_TEXT }]);
    const stats = new DownloadCounters();

    const records = await fetchIndex("https://bucket/file.idx", { fetch: wire.fetch, stats });

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ variable: "TMP", level: "850 mb", offset: 0, length: 100 });
    expect(stats.requests).toBe(1);
    expect(stats.retries).toBe(0);
    expect(stats.responseBytes).toBe(IDX_TEXT.length);
  });

  it("retries throttling and 5xx, then succeeds", async () => {
    const wire = stubFetch([{ status: 503 }, { status: 429 }, { status: 200, body: IDX_TEXT }]);
    const stats = new DownloadCounters();

    const records = await fetchIndex("https://bucket/file.idx", {
      fetch: wire.fetch,
      stats,
      sleep: noSleep,
    });

    expect(records).toHaveLength(3);
    expect(stats.requests).toBe(3);
    expect(stats.retries).toBe(2);
    expect(stats.responseBytes).toBe(IDX_TEXT.length);
  });

  it("gives up after three attempts", async () => {
    const wire = stubFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    const stats = new DownloadCounters();

    await expect(
      fetchIndex("https://bucket/file.idx", { fetch: wire.fetch, stats, sleep: noSleep }),
    ).rejects.toThrow(/failed with 500/);
    expect(stats.requests).toBe(3);
    expect(stats.retries).toBe(2);
  });

  it("other client errors stay fatal on the spot", async () => {
    const wire = stubFetch([{ status: 404 }]);
    const stats = new DownloadCounters();

    await expect(
      fetchIndex("https://bucket/missing.idx", { fetch: wire.fetch, stats, sleep: noSleep }),
    ).rejects.toThrow(/404/);
    expect(wire.requests).toHaveLength(1);
  });

  it("transport errors burn a retry", async () => {
    const wire = stubFetch([new Error("connection reset"), { status: 200, body: IDX_TEXT }]);

    const records = await fetchIndex("https://bucket/file.idx", {
      fetch: wire.fetch,
      sleep: noSleep,
    });

    expect(records).toHaveLength(3);
    expect(wire.requests).toHaveLength(2);
  });
});

describe("fetchRecord retry manners", () => {
  const record = {
    variable: "TMP",
    level: "850 mb",
    forecast: "24 hour fcst",
    offset: 100,
    length: 120,
  };

  it("sends the record's byte range and returns the 206 body", async () => {
    const wire = stubFetch([{ status: 206, body: "GRIB-bytes" }]);
    const stats = new DownloadCounters();

    const bytes = await fetchRecord("https://bucket/file", record, { fetch: wire.fetch, stats });

    expect(new TextDecoder().decode(bytes)).toBe("GRIB-bytes");
    expect(wire.requests[0]!.init?.headers).toMatchObject({ Range: byteRange(record) });
    expect(stats.responseBytes).toBe(10);
  });

  it("a 200 answer to a Range request is a failure, never a whole-file masquerade", async () => {
    const wire = stubFetch([{ status: 200, body: "the whole file" }]);

    await expect(
      fetchRecord("https://bucket/file", record, { fetch: wire.fetch, sleep: noSleep }),
    ).rejects.toThrow(/200 to a Range request/);
  });
});
