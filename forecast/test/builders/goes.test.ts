import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseManifest,
  parseObservationDocument,
  parseObservationManifest,
  type ObservationDocument,
} from "@azohra/meteo.briefing/contract";
import {
  appendGoesHistory,
  buildGoesProduct,
  listedKeys,
  mergedWindow,
  observationManifest,
  PRODUCTS,
  sampleSites,
  scanKeyInstant,
  scanKeysSince,
  siteDocument,
  siteIndex,
  type GoesSite,
  type GranuleSampler,
  type ObservationEntry,
  type SiteIndices,
} from "../../src/builders/goes.js";
import { packagedModelsPath } from "../../src/catalogue.js";
import type { GranuleReader, GranuleVariable } from "../../src/builders/granule.js";
import { splitMembers } from "../../src/history.js";
import { roundDocument } from "../../src/publish.js";
import { DownloadCounters } from "../../src/providers/transport.js";
import { noSleep, stubFetch } from "../helpers/wire.js";

// The probe-verified fixed-grid coordinate axes: int16 scan angles scaled
// by ±5.6e-05 rad with offsets ∓0.151844, x ascending west→east, y
// descending north→south, 5424 points each — identical on DSRF and AODF.
const GRID_STEP_RAD = 5.6e-5;
const GRID_OFFSET_RAD = 0.151844;
const GRID_POINTS = 5424;

class FakeVariable implements GranuleVariable {
  private readonly attributes: Record<string, number>;
  private readonly data: Float64Array | null;

  constructor(attributes: Record<string, number>, data: Float64Array | null = null) {
    this.attributes = attributes;
    this.data = data;
  }

  attribute(name: string): number {
    if (!(name in this.attributes)) {
      throw new Error(`fake variable has no attribute ${name}`);
    }
    return this.attributes[name];
  }

  values(): Float64Array {
    if (this.data === null) {
      throw new Error("fake variable has no values");
    }
    return this.data;
  }

  pixel(): number | null {
    throw new Error("fake grid is for navigation, not sampling");
  }
}

class FakeGranule implements GranuleReader {
  private readonly variables: Record<string, FakeVariable>;

  constructor() {
    const x = new Float64Array(GRID_POINTS);
    const y = new Float64Array(GRID_POINTS);
    for (let index = 0; index < GRID_POINTS; index += 1) {
      x[index] = -GRID_OFFSET_RAD + index * GRID_STEP_RAD;
      y[index] = GRID_OFFSET_RAD - index * GRID_STEP_RAD;
    }
    this.variables = {
      x: new FakeVariable({}, x),
      y: new FakeVariable({}, y),
      // The live granule's own projection attributes.
      goes_imager_projection: new FakeVariable({
        perspective_point_height: 35786023.0,
        semi_major_axis: 6378137.0,
        semi_minor_axis: 6356752.31414,
        longitude_of_projection_origin: -137.0,
      }),
    };
  }

  variable(name: string): GranuleVariable {
    const variable = this.variables[name];
    if (variable === undefined) {
      throw new Error(`fake granule has no variable ${name}`);
    }
    return variable;
  }
}

const BUILD_ENV = ["METEO_GOES_BACKFILL_HOURS"] as const;
let savedEnv: Partial<Record<string, string | undefined>> = {};
beforeEach(() => {
  savedEnv = {};
  for (const name of BUILD_ENV) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of BUILD_ENV) {
    const value = savedEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("the product table", () => {
  it("matches models.json's observationModels exactly", () => {
    const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
      observationModels: Array<Record<string, unknown> & { slug: string }>;
    };
    const entries = new Map(catalogue.observationModels.map((entry) => [entry.slug, entry]));

    // Catalogue and builder declare the same datasets, nothing more.
    expect([...entries.keys()].sort()).toEqual(Object.keys(PRODUCTS).sort());
    expect(Object.keys(PRODUCTS).sort()).toEqual(["goes18-aod", "goes18-dsr"]);
    for (const [slug, product] of Object.entries(PRODUCTS)) {
      const entry = entries.get(slug)!;
      expect(product.slug).toBe(slug);
      expect(entry["provider"]).toBe("NOAA");
      // 10-minute full-disk cadence — six granules per hour directory for
      // BOTH products, not the hourly cadence older DSR docs imply.
      expect(entry["cadenceMinutes"]).toBe(10);
      // Effective at-site cell (~2.4 × 4.1 km at 49°N view angle), not
      // the 2 km nadir nominal; the AODF granule rides the same grid.
      expect(entry["gridKm"]).toBe(3);
      // Operational NOAA products (OR_ prefix).
      expect(entry["experimental"]).toBe(false);
      // The catalogue entry and the builder name the same measured quantity.
      expect(entry["quantity"]).toBe(product.quantity);
    }

    expect(PRODUCTS["goes18-dsr"].prefix).toBe("ABI-L2-DSRF");
    expect(PRODUCTS["goes18-dsr"].variable).toBe("DSR");
    expect(PRODUCTS["goes18-dsr"].valueKey).toBe("downwardShortwaveWm2");
    expect(PRODUCTS["goes18-dsr"].quantity).toBe("downwardShortwave");
    // DSR: DQF <= 1 admits the binary flag's degraded/invalid state,
    // published labelled (quality: 1); night stays out through the
    // unmasked half of the gate (fill pixels carry DQF 0).
    expect(PRODUCTS["goes18-dsr"].maxQuality).toBe(1);
    expect(PRODUCTS["goes18-aod"].prefix).toBe("ABI-L2-AODF");
    expect(PRODUCTS["goes18-aod"].variable).toBe("AOD");
    expect(PRODUCTS["goes18-aod"].valueKey).toBe("aot");
    expect(PRODUCTS["goes18-aod"].quantity).toBe("aot");
    // AOD: high + medium quality (Zhang, Kondragunta et al. 2020).
    expect(PRODUCTS["goes18-aod"].maxQuality).toBe(1);
  });

  it("the published aot rounds to three decimals in the contract table", () => {
    expect(roundDocument({ aot: 1.9336401224136353 })).toEqual({ aot: 1.934 });
  });
});

describe("site navigation", () => {
  it("site indices match the live probe", () => {
    // Ground truth measured against a real granule: the PUG forward
    // equations put the founding sites on these exact pixels.
    const granule = new FakeGranule();
    const expected: Record<string, [number, number, number, number]> = {
      dundee: [476, 3366, 49.291977, -117.183569],
      erie: [479, 3360, 49.204789, -117.406951],
      flagpole: [470, 3359, 49.507695, -117.310423],
      "red-mountain": [481, 3349, 49.091868, -117.820838],
    };
    for (const [name, [yIndex, xIndex, latitude, longitude]] of Object.entries(expected)) {
      expect(siteIndex(granule, { name, latitude, longitude })).toEqual([yIndex, xIndex]);
    }
  });

  it("refuses points off the disk", () => {
    const granule = new FakeGranule();
    // The antipode of the satellite longitude is behind the earth.
    expect(() => siteIndex(granule, { name: "antipode", latitude: 0.0, longitude: 43.0 })).toThrow(
      /outside the GOES-18 full-disk grid/,
    );
  });

  it("scan key stamps parse to UTC instants", () => {
    expect(
      scanKeyInstant(
        "ABI-L2-DSRF/2026/222/05/OR_ABI-L2-DSRF-M6_G18_s20262220500213_e20262220509522_c20262220515340.nc",
      ),
    ).toBe("2026-08-10T05:00:21Z");
    // The AODF keys carry the identical stamp grammar (live listing).
    expect(
      scanKeyInstant(
        "ABI-L2-AODF/2026/222/06/OR_ABI-L2-AODF-M6_G18_s20262220600214_e20262220609522_c20262220612547.nc",
      ),
    ).toBe("2026-08-10T06:00:21Z");
    expect(scanKeyInstant("ABI-L2-DSRF/2026/222/05/no-stamp-here.nc")).toBeNull();
  });
});

function listingXml(keys: readonly string[]): string {
  const contents = keys
    .map((key) => `<Contents><Key>${key}</Key><Size>123</Size></Contents>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
    `<Name>noaa-goes18</Name><KeyCount>${keys.length}</KeyCount>${contents}</ListBucketResult>`
  );
}

function granuleKey(product: string, dayOfYear: number, hour: string, stamp: string): string {
  return `ABI-L2-${product}/2026/${dayOfYear}/${hour}/OR_ABI-L2-${product}-M6_G18_s${stamp}_e20262220000000_c20262220000000.nc`;
}

describe("the S3 listing walk", () => {
  it("takes each Contents' Key, .nc only", () => {
    const xml = listingXml([
      granuleKey("DSRF", 222, "05", "20262220500213"),
      "ABI-L2-DSRF/2026/222/05/not-a-granule.txt",
      granuleKey("DSRF", 222, "05", "20262220510213"),
    ]);
    expect(listedKeys(xml)).toEqual([
      granuleKey("DSRF", 222, "05", "20262220500213"),
      granuleKey("DSRF", 222, "05", "20262220510213"),
    ]);
  });

  it("decodes XML entities in keys", () => {
    expect(listedKeys("<Contents><Key>a&amp;b&lt;c&gt;&#46;nc</Key></Contents>")).toEqual([
      "a&b<c>.nc",
    ]);
  });

  it("an empty listing lists nothing", () => {
    expect(listedKeys(listingXml([]))).toEqual([]);
  });

  it("an unterminated Contents fails loudly", () => {
    expect(() => listedKeys("<Contents><Key>truncated.nc</Key>")).toThrow(
      /unterminated <Contents>/,
    );
  });
});

describe("scanKeysSince", () => {
  const product = PRODUCTS["goes18-dsr"];

  it("walks hour prefixes and keeps stamps strictly after lastObserved, chronological", async () => {
    const hour05 = [
      granuleKey("DSRF", 222, "05", "20262220520213"), // 05:20 — at/before the cut
      granuleKey("DSRF", 222, "05", "20262220550213"), // deliberately out of order
      granuleKey("DSRF", 222, "05", "20262220540213"),
    ];
    const hour06 = [granuleKey("DSRF", 222, "06", "20262220600213")];
    const wire = stubFetch([
      { status: 200, body: listingXml(hour05) },
      { status: 200, body: listingXml(hour06) },
    ]);
    const stats = new DownloadCounters();

    const keys = await scanKeysSince(
      product,
      new Date("2026-08-10T05:20:21Z"),
      new Date("2026-08-10T06:30:00Z"),
      stats,
      { fetch: wire.fetch, sleep: noSleep },
    );

    expect(wire.requests.map((request) => request.url)).toEqual([
      "https://noaa-goes18.s3.amazonaws.com/?list-type=2&prefix=ABI-L2-DSRF/2026/222/05/",
      "https://noaa-goes18.s3.amazonaws.com/?list-type=2&prefix=ABI-L2-DSRF/2026/222/06/",
    ]);
    expect(keys.map(([, instant]) => instant)).toEqual([
      "2026-08-10T05:40:21Z",
      "2026-08-10T05:50:21Z",
      "2026-08-10T06:00:21Z",
    ]);
    expect(stats.requests).toBe(2);
  });

  it("retries a 5xx listing with the GOES backoff, then succeeds", async () => {
    const delays: number[] = [];
    const wire = stubFetch([
      { status: 503 },
      { status: 200, body: listingXml([granuleKey("DSRF", 222, "06", "20262220610213")]) },
    ]);
    const stats = new DownloadCounters();

    const keys = await scanKeysSince(
      product,
      new Date("2026-08-10T06:01:00Z"),
      new Date("2026-08-10T06:05:00Z"),
      stats,
      {
        fetch: wire.fetch,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(keys).toHaveLength(1);
    expect(delays).toEqual([1000]); // 2^0 seconds after the first failure
    expect(stats.requests).toBe(2);
    expect(stats.retries).toBe(1);
  });

  it("a client error is fatal on the spot, never retried", async () => {
    const wire = stubFetch([{ status: 403 }]);

    await expect(
      scanKeysSince(
        product,
        new Date("2026-08-10T06:01:00Z"),
        new Date("2026-08-10T06:05:00Z"),
        new DownloadCounters(),
        { fetch: wire.fetch, sleep: noSleep },
      ),
    ).rejects.toThrow(/failed with 403/);
    expect(wire.requests).toHaveLength(1);
  });
});

describe("sampleSites over a scripted granule", () => {
  // A pixel-level granule stub: navigation is bypassed with provided
  // indices, so only the gate is under test (the REAL gate over real
  // HDF5 bytes is goes-granule.test.ts's bit-identity suite).
  function scriptedGranule(
    values: Record<string, number | null>,
    dqf: Record<string, number | null>,
  ): GranuleReader {
    const at = (table: Record<string, number | null>) => ({
      attribute: () => {
        throw new Error("unused");
      },
      values: () => {
        throw new Error("unused");
      },
      pixel: (row: number, column: number) => table[`${row},${column}`] ?? null,
    });
    return {
      variable: (name: string) => (name === "DQF" ? at(dqf) : at(values)),
    };
  }

  const sites: GoesSite[] = [
    { slug: "day", name: "Day", latitude: 0, longitude: 0 },
    { slug: "night", name: "Night", latitude: 0, longitude: 0 },
    { slug: "flagged", name: "Flagged", latitude: 0, longitude: 0 },
  ];
  const indices: SiteIndices = { day: [0, 0], night: [0, 1], flagged: [0, 2] };

  it("publishes only unmasked AND quality — never DQF alone", () => {
    const { samples } = sampleSites(
      scriptedGranule(
        { "0,0": 621.5, "0,1": null, "0,2": 400.0 }, // night is fill/masked
        { "0,0": 0, "0,1": 0, "0,2": 1 }, // …but night carries DQF 0: the trap
      ),
      PRODUCTS["goes18-dsr"],
      sites,
      indices,
    );
    // Night's DQF 0 proves nothing (masked wins); the degraded retrieval
    // passes carrying its DQF so publish can label it.
    expect(samples).toEqual({
      day: { value: 621.5, quality: 0 },
      flagged: { value: 400.0, quality: 1 },
    });
  });

  it("a masked DQF is an absence even under a valid value", () => {
    const { samples } = sampleSites(
      scriptedGranule({ "0,0": 621.5 }, { "0,0": null }),
      PRODUCTS["goes18-dsr"],
      sites.slice(0, 1),
      { day: [0, 0] },
    );
    expect(samples).toEqual({});
  });
});

describe("the merged window", () => {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  it("deduplicates by instant and trims to the window", async () => {
    const published = {
      observations: [
        { observedAt: "2026-08-05T20:00:21Z", downwardShortwaveWm2: 500.0 },
        { observedAt: "2026-08-09T20:00:21Z", downwardShortwaveWm2: 610.0 },
        { observedAt: "2026-08-09T20:10:21Z", downwardShortwaveWm2: 600.0 },
      ],
    };

    const { window, newlyAdded } = await mergedWindow(
      PRODUCTS["goes18-dsr"],
      "dundee",
      [
        // A re-fetched instant replaces its published twin, never doubles.
        { observedAt: "2026-08-09T20:10:21Z", downwardShortwaveWm2: 601.5 },
        { observedAt: "2026-08-09T22:00:21Z", downwardShortwaveWm2: 580.0 },
      ],
      async () => encode(published),
    );

    expect(window.map((entry) => entry.observedAt)).toEqual([
      // The 08-05 instant fell out of the 72 h window behind the newest.
      "2026-08-09T20:00:21Z",
      "2026-08-09T20:10:21Z",
      "2026-08-09T22:00:21Z",
    ]);
    expect(window[1]["downwardShortwaveWm2"]).toBe(601.5);
    // The re-fetched instant is NOT new to the window — only 22:00 is.
    expect(newlyAdded.map((entry) => entry.observedAt)).toEqual(["2026-08-09T22:00:21Z"]);
  });

  it("starts empty for a new site", async () => {
    const { window, newlyAdded } = await mergedWindow(
      PRODUCTS["goes18-dsr"],
      "dundee",
      [],
      async () => null,
    );
    expect(window).toEqual([]);
    expect(newlyAdded).toEqual([]);
  });
});

function archivedLines(archive: string): unknown[] {
  return splitMembers(new Uint8Array(readFileSync(archive))).flatMap((member) =>
    member.lines.map((line) => JSON.parse(line) as unknown),
  );
}

const noPublishedHistory = async (): Promise<Uint8Array> => new Uint8Array(0);

describe("history", () => {
  it("archives each instant exactly once", async () => {
    // A re-listed or backfilled batch must append nothing it already
    // archived: the merge's newly-added set is the single source of truth.
    const product = PRODUCTS["goes18-aod"];
    const published: { observations: ObservationEntry[] } = {
      observations: [{ observedAt: "2026-08-09T20:00:21Z", aot: 1.934 }],
    };
    const batch: ObservationEntry[] = [
      { observedAt: "2026-08-09T20:00:21Z", aot: 1.9336401224136353 }, // re-listed
      { observedAt: "2026-08-09T20:10:21Z", aot: 2.9061758518218994 },
    ];
    const historyDir = join(mkdtempSync(join(tmpdir(), "goes-")), "history");
    const fetchPublished = async () => new TextEncoder().encode(JSON.stringify(published));

    const { window, newlyAdded } = await mergedWindow(product, "dundee", batch, fetchPublished);
    await appendGoesHistory(product, "dundee", newlyAdded, historyDir, noPublishedHistory);

    const archive = join(historyDir, "dundee", "2026-08.jsonl.gz");
    // Only the genuinely new instant landed, rounded exactly as published.
    expect(archivedLines(archive)).toEqual([{ observedAt: "2026-08-09T20:10:21Z", aot: 2.906 }]);

    // The next tick re-lists the same granules against the grown window:
    // nothing is new, and the archive's bytes do not move.
    published.observations = window;
    const before = readFileSync(archive);
    const secondRound = await mergedWindow(product, "dundee", batch, fetchPublished);
    expect(secondRound.newlyAdded).toEqual([]);
    await appendGoesHistory(
      product,
      "dundee",
      secondRound.newlyAdded,
      historyDir,
      noPublishedHistory,
    );
    expect(readFileSync(archive)).toEqual(before);
  });

  it("months follow the observation instant, not the run", async () => {
    const product = PRODUCTS["goes18-dsr"];
    const batch: ObservationEntry[] = [
      { observedAt: "2026-08-31T23:50:21Z", downwardShortwaveWm2: 12.34 },
      { observedAt: "2026-09-01T00:00:21Z", downwardShortwaveWm2: 11.06 },
    ];
    const historyDir = join(mkdtempSync(join(tmpdir(), "goes-")), "history");

    const { newlyAdded } = await mergedWindow(product, "dundee", batch, async () => null);
    await appendGoesHistory(product, "dundee", newlyAdded, historyDir, noPublishedHistory);

    // One granule either side of midnight: each instant in its own month.
    expect(archivedLines(join(historyDir, "dundee", "2026-08.jsonl.gz"))).toEqual([
      { observedAt: "2026-08-31T23:50:21Z", downwardShortwaveWm2: 12.3 },
    ]);
    expect(archivedLines(join(historyDir, "dundee", "2026-09.jsonl.gz"))).toEqual([
      { observedAt: "2026-09-01T00:00:21Z", downwardShortwaveWm2: 11.1 },
    ]);
  });
});

describe("the document contract", () => {
  it("a built AOD document passes the contract's observation guard", () => {
    const site: GoesSite = {
      slug: "dundee",
      name: "Dundee",
      latitude: 49.291977,
      longitude: -117.183569,
      timeZone: "America/Vancouver",
    };
    const observations: ObservationEntry[] = [
      { observedAt: "2026-08-09T20:00:21Z", aot: 1.9336401224136353 },
      { observedAt: "2026-08-09T20:10:21Z", aot: 2.9061758518218994 },
    ];
    const document = siteDocument(
      PRODUCTS["goes18-aod"],
      site,
      observations,
      "2026-08-09T20:18:03Z",
    );

    const parsed = parseObservationDocument(document);
    expect(parsed).not.toBeNull();
    expect(parsed!.quantity).toBe("aot");
    expect(parsed!.site.timeZone).toBe("America/Vancouver");
    // The contract's rounding table: aot publishes at 3 decimals.
    expect(parsed!.observations.map((entry) => (entry as { aot: number }).aot)).toEqual([
      1.934, 2.906,
    ]);

    // Sensitivity: the observations[] union really constrains the value
    // key — a misnamed field is rejected, not waved through.
    const wrong = JSON.parse(JSON.stringify(document)) as ObservationDocument;
    (wrong.observations as unknown[])[0] = { observedAt: "2026-08-09T20:00:21Z", aod: 1.934 };
    expect(parseObservationDocument(wrong)).toBeNull();
  });

  it("a built DSR document passes too", () => {
    const site: GoesSite = {
      slug: "erie",
      name: "Erie",
      latitude: 49.204789,
      longitude: -117.406951,
    };
    const observations: ObservationEntry[] = [
      { observedAt: "2026-08-09T20:00:21Z", downwardShortwaveWm2: 611.13 },
    ];
    const document = siteDocument(
      PRODUCTS["goes18-dsr"],
      site,
      observations,
      "2026-08-09T20:18:03Z",
    );

    const parsed = parseObservationDocument(document);
    expect(parsed).not.toBeNull();
    expect(parsed!.quantity).toBe("downwardShortwave");
    expect(parsed!.site.timeZone).toBeUndefined();
    expect((parsed!.observations[0] as { downwardShortwaveWm2: number }).downwardShortwaveWm2).toBe(
      611.1,
    );
  });

  it("a built observation manifest passes the contract's manifest union", () => {
    // The union's second branch: the contract must accept the exact shape
    // the builder publishes (it rejected it before the observation branch
    // existed — GOES manifests were unparseable by the TypeScript contract
    // while sitting in production).
    const manifest = observationManifest(
      "goes18-aod",
      [
        { slug: "dundee", name: "Dundee", latitude: 0, longitude: 0 },
        { slug: "erie", name: "Erie", latitude: 0, longitude: 0 },
      ],
      "2026-08-08T22:01:24Z",
      "2026-08-10T21:56:24Z",
      574,
      { downloads: 12, downloadBytes: 48211, retries: 0, durationMs: 8112 },
    );
    expect(parseObservationManifest(manifest)).not.toBeNull();
    expect(parseManifest(manifest)).not.toBeNull();
    expect(manifest["referenceTime"]).toBe(manifest["lastObservedAt"]);
  });
});

const SITES: GoesSite[] = [
  {
    slug: "dundee",
    name: "Dundee",
    latitude: 49.291977,
    longitude: -117.183569,
    timeZone: "America/Vancouver",
  },
  { slug: "erie", name: "Erie", latitude: 49.204789, longitude: -117.406951 },
];

/** A sampler that records URLs and answers from a script, per granule; a bare number is a best-quality (DQF 0) retrieval. */
function scriptedSampler(
  sampled: string[],
  answers: Record<string, Record<string, number | { value: number; quality: number }>> = {},
): GranuleSampler {
  return async (url, _product, _sites, indices) => {
    sampled.push(url);
    const stamp = /_s(\d{14})/.exec(url)![1];
    const samples = Object.fromEntries(
      Object.entries(answers[stamp] ?? {}).map(([slug, sample]) => [
        slug,
        typeof sample === "number" ? { value: sample, quality: 0 } : sample,
      ]),
    );
    return { indices, samples };
  };
}

describe("buildGoesProduct", () => {
  it("maxSteps caps the granule walk", async () => {
    // --max-steps reaches observation builders as the forwarded option; a
    // capped build samples only the first N granules instead of the whole
    // backlog.
    process.env["METEO_GOES_BACKFILL_HOURS"] = "1";
    const hour05 = [
      granuleKey("DSRF", 222, "05", "20262220540213"),
      granuleKey("DSRF", 222, "05", "20262220550213"),
    ];
    const hour06 = [
      granuleKey("DSRF", 222, "06", "20262220600213"),
      granuleKey("DSRF", 222, "06", "20262220610213"),
      granuleKey("DSRF", 222, "06", "20262220620213"),
    ];
    const run = async (maxSteps?: number) => {
      const wire = stubFetch([
        { status: 200, body: listingXml(hour05) },
        { status: 200, body: listingXml(hour06) },
      ]);
      const sampled: string[] = [];
      await buildGoesProduct(PRODUCTS["goes18-dsr"], {
        fetch: wire.fetch,
        sleep: noSleep,
        now: () => new Date("2026-08-10T06:30:00Z"),
        sites: [],
        publishedManifest: async () => null,
        granuleSamples: scriptedSampler(sampled),
        log: () => {},
        ...(maxSteps !== undefined ? { maxSteps } : {}),
      });
      return sampled;
    };

    expect(await run(2)).toHaveLength(2);
    expect(await run()).toHaveLength(5);
  });

  it("a build with no new granules publishes nothing", async () => {
    process.env["METEO_GOES_BACKFILL_HOURS"] = "1";
    const wire = stubFetch([
      { status: 200, body: listingXml([]) },
      { status: 200, body: listingXml([]) },
    ]);
    const outputRoot = mkdtempSync(join(tmpdir(), "goes-out-"));
    const lines: string[] = [];

    await buildGoesProduct(PRODUCTS["goes18-dsr"], {
      fetch: wire.fetch,
      sleep: noSleep,
      now: () => new Date("2026-08-10T06:30:00Z"),
      sites: SITES,
      outputRoot,
      publishedManifest: async () => null,
      log: (line) => lines.push(line),
    });

    expect(lines.join("\n")).toMatch(/No GOES-18 DSR granules newer than/);
    expect(existsSync(join(outputRoot, "goes18-dsr", "manifest.json"))).toBe(false);
  });

  it("a cold-start build publishes documents, manifest, and history", async () => {
    process.env["METEO_GOES_BACKFILL_HOURS"] = "1";
    const wire = stubFetch([
      { status: 200, body: listingXml([granuleKey("AODF", 222, "05", "20262220550213")]) },
      { status: 200, body: listingXml([granuleKey("AODF", 222, "06", "20262220600213")]) },
    ]);
    const sampled: string[] = [];
    const sampler = scriptedSampler(sampled, {
      // Raw float64 retrievals: the rounding table is applied at publish.
      // Erie's 05:50 retrieval is medium quality — the label must survive.
      "20262220550213": { dundee: 1.9336401224136353, erie: { value: 0.2224, quality: 1 } },
      "20262220600213": { dundee: 2.9061758518218994 }, // erie rejected: absence
    });
    const outputRoot = mkdtempSync(join(tmpdir(), "goes-out-"));
    const lines: string[] = [];

    await buildGoesProduct(PRODUCTS["goes18-aod"], {
      fetch: wire.fetch,
      sleep: noSleep,
      now: () => new Date("2026-08-10T06:30:00Z"),
      sites: SITES,
      outputRoot,
      publishedManifest: async () => null,
      fetchPublished: async () => null,
      publishedHistory: noPublishedHistory,
      granuleSamples: sampler,
      log: (line) => lines.push(line),
    });

    expect(sampled).toEqual([
      "https://noaa-goes18.s3.amazonaws.com/" + granuleKey("AODF", 222, "05", "20262220550213"),
      "https://noaa-goes18.s3.amazonaws.com/" + granuleKey("AODF", 222, "06", "20262220600213"),
    ]);

    // The site documents parse under the contract guard, rounded.
    const dundee = parseObservationDocument(
      JSON.parse(readFileSync(join(outputRoot, "goes18-aod", "sites", "dundee.json"), "utf-8")),
    );
    expect(dundee).not.toBeNull();
    expect(dundee!.observations).toEqual([
      { observedAt: "2026-08-10T05:50:21Z", aot: 1.934 },
      { observedAt: "2026-08-10T06:00:21Z", aot: 2.906 },
    ]);
    expect(dundee!.quantity).toBe("aot");
    expect(dundee!.observed.firstObservedAt).toBe("2026-08-10T05:50:21Z");
    expect(dundee!.observed.lastObservedAt).toBe("2026-08-10T06:00:21Z");
    expect(dundee!.site.timeZone).toBe("America/Vancouver");

    const erie = parseObservationDocument(
      JSON.parse(readFileSync(join(outputRoot, "goes18-aod", "sites", "erie.json"), "utf-8")),
    );
    expect(erie).not.toBeNull();
    // The rejected 06:00 retrieval is an absence, never zero; the accepted
    // medium-quality one carries its label through the contract guard.
    expect(erie!.observations).toEqual([
      { observedAt: "2026-08-10T05:50:21Z", aot: 0.222, quality: 1 },
    ]);
    expect(erie!.site.timeZone).toBeUndefined();

    // The manifest parses under the union guard and counts the window.
    const manifestText = readFileSync(join(outputRoot, "goes18-aod", "manifest.json"), "utf-8");
    const manifest = parseObservationManifest(JSON.parse(manifestText));
    expect(manifest).not.toBeNull();
    expect(parseManifest(JSON.parse(manifestText))).not.toBeNull();
    expect(manifest!.model).toBe("goes18-aod");
    expect(manifest!.observationCount).toBe(3);
    expect(manifest!.firstObservedAt).toBe("2026-08-10T05:50:21Z");
    expect(manifest!.lastObservedAt).toBe("2026-08-10T06:00:21Z");
    expect(manifest!.referenceTime).toBe(manifest!.lastObservedAt);
    expect(manifest!.sites).toEqual([
      { name: "Dundee", slug: "dundee" },
      { name: "Erie", slug: "erie" },
    ]);
    // Listings only — the scripted sampler downloaded no granule bytes.
    expect(manifest!.stats["downloads"]).toBe(2);

    // Each instant archived once, rounded exactly as published.
    expect(
      archivedLines(join(outputRoot, "goes18-aod", "history", "dundee", "2026-08.jsonl.gz")),
    ).toEqual([
      { observedAt: "2026-08-10T05:50:21Z", aot: 1.934 },
      { observedAt: "2026-08-10T06:00:21Z", aot: 2.906 },
    ]);

    expect(lines.join("\n")).toMatch(/Published 3 new GOES-18 AOD observations/);
  });

  it("history is the operator's choice: off writes no archives, on is byte-identical to the default", async () => {
    process.env["METEO_GOES_BACKFILL_HOURS"] = "1";
    const scratch = mkdtempSync(join(tmpdir(), "goes-out-"));
    const build = async (root: string, history?: boolean) => {
      const wire = stubFetch([
        { status: 200, body: listingXml([granuleKey("AODF", 222, "05", "20262220550213")]) },
        { status: 200, body: listingXml([granuleKey("AODF", 222, "06", "20262220600213")]) },
      ]);
      const seedReads: string[] = [];
      await buildGoesProduct(PRODUCTS["goes18-aod"], {
        fetch: wire.fetch,
        sleep: noSleep,
        now: () => new Date("2026-08-10T06:30:00Z"),
        sites: SITES,
        outputRoot: join(scratch, root),
        publishedManifest: async () => null,
        fetchPublished: async () => null,
        publishedHistory: async (model, siteId, month) => {
          seedReads.push(`${model}/${siteId}/${month}`);
          return new Uint8Array(0);
        },
        granuleSamples: scriptedSampler([], {
          "20262220550213": { dundee: 1.9336401224136353, erie: 0.2224 },
          "20262220600213": { dundee: 2.9061758518218994 },
        }),
        log: () => {},
        ...(history !== undefined ? { history } : {}),
      });
      return seedReads;
    };

    await build("default");
    await build("on", true);
    const offSeedReads = await build("off", false);

    // Off: no archive tree — and no history seed read left the process.
    expect(existsSync(join(scratch, "off", "goes18-aod", "history"))).toBe(false);
    expect(offSeedReads).toEqual([]);

    // The observation documents are identical across all three choices…
    const site = (root: string, slug: string) =>
      readFileSync(join(scratch, root, "goes18-aod", "sites", `${slug}.json`));
    for (const slug of ["dundee", "erie"]) {
      expect(site("on", slug).equals(site("default", slug)), slug).toBe(true);
      expect(site("off", slug).equals(site("default", slug)), slug).toBe(true);
    }

    // …explicit history on is byte-identical to the default…
    const archive = (root: string) =>
      readFileSync(join(scratch, root, "goes18-aod", "history", "dundee", "2026-08.jsonl.gz"));
    expect(archive("on").equals(archive("default"))).toBe(true);

    // …and the manifest does not know the choice was made (its stats and
    // wall-clock stamp are the only fields that vary run to run).
    const manifest = (root: string) => {
      const parsed = JSON.parse(
        readFileSync(join(scratch, root, "goes18-aod", "manifest.json"), "utf-8"),
      ) as Record<string, unknown>;
      delete parsed["stats"];
      delete parsed["generatedAt"];
      return parsed;
    };
    expect(manifest("off")).toEqual(manifest("default"));
    expect(manifest("on")).toEqual(manifest("default"));
  });

  it("an incremental build samples only granules newer than the published manifest", async () => {
    process.env["METEO_GOES_BACKFILL_HOURS"] = "6";
    const wire = stubFetch([
      // The manifest's lastObservedAt (06:00:21) floors the walk to its
      // own hour — one listing, not six backfill hours of them.
      {
        status: 200,
        body: listingXml([
          granuleKey("AODF", 222, "06", "20262220600213"), // already published
          granuleKey("AODF", 222, "06", "20262220610213"),
        ]),
      },
    ]);
    const sampled: string[] = [];
    const outputRoot = mkdtempSync(join(tmpdir(), "goes-out-"));

    await buildGoesProduct(PRODUCTS["goes18-aod"], {
      fetch: wire.fetch,
      sleep: noSleep,
      now: () => new Date("2026-08-10T06:30:00Z"),
      sites: SITES,
      outputRoot,
      publishedManifest: async () =>
        ({
          model: "goes18-aod",
          referenceTime: "2026-08-10T06:00:21Z",
          generatedAt: "2026-08-10T06:08:00Z",
          lastObservedAt: "2026-08-10T06:00:21Z",
        }) as never,
      fetchPublished: async () => null,
      publishedHistory: noPublishedHistory,
      granuleSamples: scriptedSampler(sampled, {
        "20262220610213": { dundee: 0.5 },
      }),
      log: () => {},
    });

    expect(sampled).toEqual([
      "https://noaa-goes18.s3.amazonaws.com/" + granuleKey("AODF", 222, "06", "20262220610213"),
    ]);
    const dundee = parseObservationDocument(
      JSON.parse(readFileSync(join(outputRoot, "goes18-aod", "sites", "dundee.json"), "utf-8")),
    );
    expect(dundee!.observations).toEqual([{ observedAt: "2026-08-10T06:10:21Z", aot: 0.5 }]);
  });

  it("all-night granules publish nothing rather than zeros", async () => {
    process.env["METEO_GOES_BACKFILL_HOURS"] = "1";
    const wire = stubFetch([
      { status: 200, body: listingXml([granuleKey("DSRF", 222, "05", "20262220550213")]) },
      { status: 200, body: listingXml([]) },
    ]);
    const outputRoot = mkdtempSync(join(tmpdir(), "goes-out-"));
    const lines: string[] = [];

    await buildGoesProduct(PRODUCTS["goes18-dsr"], {
      fetch: wire.fetch,
      sleep: noSleep,
      now: () => new Date("2026-08-10T06:30:00Z"),
      sites: SITES,
      outputRoot,
      publishedManifest: async () => null,
      granuleSamples: scriptedSampler([]), // every pixel gated: no samples
      log: (line) => lines.push(line),
    });

    expect(lines.join("\n")).toMatch(/No valid GOES-18 DSR retrievals in 1 granules/);
    expect(existsSync(join(outputRoot, "goes18-dsr", "manifest.json"))).toBe(false);
  });
});
