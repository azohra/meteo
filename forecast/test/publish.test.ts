import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cataloguedModelSlugs, packagedModelsPath } from "../src/catalogue.js";
import {
  compactJson,
  manifestStats,
  roundContract,
  roundDocument,
  runsIndex,
  writeJson,
  writeRunsIndex,
  type PublishedManifest,
} from "../src/publish.js";

describe("roundDocument", () => {
  it("rounds each quantity to its schema precision", () => {
    const hour = {
      validAt: "2026-08-08T21:00:00Z",
      surface: {
        seaLevelPressureHpa: 1010.714432,
        temperatureC: 28.276543,
        dewPointC: 4.716999,
        windSpeedMps: 1.4712999,
        windDirectionDeg: 245.5401,
        cloudCoverPercent: 9.2299,
        precipitationMmHr: 0.1234,
        sensibleHeatFluxWm2: 310.4499,
        latentHeatFluxWm2: 95.1111,
      },
      levels: [{ heightM: 1252.4432, verticalVelocityPaS: -0.31047 }],
      derived: {
        boundaryLayerTopM: 3223.1258376951764,
        thermalVelocityMps: 1.6349,
        cloudBaseM: 4145.06,
        usableLiftTopM: null,
      },
    };

    const rounded = roundDocument(hour) as typeof hour;

    expect(rounded.validAt).toBe("2026-08-08T21:00:00Z");
    expect(rounded.surface).toEqual({
      seaLevelPressureHpa: 1010.71,
      temperatureC: 28.28,
      dewPointC: 4.72,
      windSpeedMps: 1.47,
      windDirectionDeg: 246,
      cloudCoverPercent: 9.2,
      precipitationMmHr: 0.12,
      sensibleHeatFluxWm2: 310.4,
      latentHeatFluxWm2: 95.1,
    });
    expect(rounded.levels).toEqual([{ heightM: 1252.4, verticalVelocityPaS: -0.31 }]);
    expect(rounded.derived).toEqual({
      boundaryLayerTopM: 3223.1,
      thermalVelocityMps: 1.63,
      cloudBaseM: 4145.1,
      usableLiftTopM: null,
    });
  });

  it("science fields round to their schema precision", () => {
    const rounded = roundDocument({
      surface: {
        windGustMps: 11.4372,
        capeJkg: 851.4999,
        cinJkg: -55.501,
        pblHeightM: 1650.4444,
        lowCloudPercent: 62.049,
        midCloudPercent: 17.96,
        highCloudPercent: 4.04,
      },
      levels: [{ cloudFractionPercent: 84.9601 }],
    }) as Record<string, unknown>;

    expect(rounded.surface).toEqual({
      windGustMps: 11.44,
      capeJkg: 851, // whole J/kg
      cinJkg: -56,
      pblHeightM: 1650.4,
      lowCloudPercent: 62.0,
      midCloudPercent: 18.0,
      highCloudPercent: 4.0,
    });
    expect(rounded.levels).toEqual([{ cloudFractionPercent: 85.0 }]);
  });

  it("wind directions round to integers wrapped at north", () => {
    expect(roundDocument({ windDirectionDeg: 359.7 })).toEqual({ windDirectionDeg: 0 });
    expect(roundDocument({ windDirectionDeg: 0.2 })).toEqual({ windDirectionDeg: 0 });
    expect(roundDocument({ windDirectionDeg: null })).toEqual({ windDirectionDeg: null });
  });

  it("a negative bearing wraps non-negative — JS signed % must not leak", () => {
    expect(roundDocument({ windDirectionDeg: -0.2 })).toEqual({ windDirectionDeg: 0 });
    expect(
      Object.is(
        (roundDocument({ windDirectionDeg: -0.2 }) as { windDirectionDeg: number })
          .windDirectionDeg,
        -0,
      ),
    ).toBe(false);
    expect(roundDocument({ aspectDeg: -20 })).toEqual({ aspectDeg: 340 });
  });

  it("percentile blocks inherit the precision of their position", () => {
    const document = {
      derived: {
        usableLiftTopM: {
          ceiledMembers: 2,
          members: 21,
          p10: null,
          p25: 3222.33333,
          p50: 3585.0001,
          p75: 3822.28,
          p90: 4101.96,
        },
      },
    };

    const rounded = roundDocument(document) as typeof document;

    expect(rounded.derived.usableLiftTopM).toEqual({
      ceiledMembers: 2,
      members: 21,
      p10: null,
      p25: 3222.3,
      p50: 3585.0,
      p75: 3822.3,
      p90: 4102.0,
    });
  });

  it("coordinates and unlisted fields pass through verbatim", () => {
    const site = {
      id: "dundee",
      latitude: 49.291977,
      longitude: -117.183569,
      modelElevationM: 1217.34,
    };

    expect(roundDocument({ site })).toEqual({ site: { ...site, modelElevationM: 1217.3 } });
  });

  it("rounded values serialize without float noise", () => {
    const document = { derived: { boundaryLayerTopM: 3223.1258376951764 } };

    expect(compactJson(roundDocument(document))).toBe('{"derived":{"boundaryLayerTopM":3223.1}}');
  });
});

describe("roundContract", () => {
  it("matches CPython round() on every golden-table row", () => {
    const { rows } = JSON.parse(
      readFileSync(join(__dirname, "fixtures", "round-table", "python-round-table.json"), "utf-8"),
    ) as { rows: Array<[string, number, string]> };
    expect(rows.length).toBeGreaterThan(20000);

    const mismatches: string[] = [];
    for (const [valueRepr, decimals, expectedRepr] of rows) {
      const actual = roundContract(Number(valueRepr), decimals);
      const expected = Number(expectedRepr);
      // Object.is: NaN never appears, but signed zeros must match too —
      // round(v, 1) keeps -0.0, the decimals=0 int branch never yields it.
      if (!Object.is(actual, expected)) {
        mismatches.push(`round(${valueRepr}, ${decimals}): ${actual} != python ${expectedRepr}`);
      }
    }
    expect(mismatches, mismatches.slice(0, 10).join("\n")).toEqual([]);
  });

  it("the decimals=0 int branch refuses non-finite values, wider precisions pass them", () => {
    // Non-finite values still die at the serialization guard either way.
    expect(() => roundContract(Number.NaN, 0)).toThrowError(/non-finite/);
    expect(() => roundContract(Number.POSITIVE_INFINITY, 0)).toThrowError(/non-finite/);
    expect(Number.isNaN(roundContract(Number.NaN, 2))).toBe(true);
    expect(roundContract(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("serialization guards", () => {
  it("compactJson raises on NaN and Infinity, naming the key path", () => {
    // A NaN must kill the build; JSON.stringify would have silently
    // published null.
    expect(() => compactJson({ hours: [{ surface: { temperatureC: Number.NaN } }] })).toThrowError(
      /\$\.hours\[0\]\.surface\.temperatureC/,
    );
    expect(() => compactJson({ a: Number.NEGATIVE_INFINITY })).toThrowError(/non-finite/);
  });

  it("compactJson escapes non-ASCII exactly like Python's ensure_ascii", () => {
    expect(compactJson({ name: "Québec" })).toBe('{"name":"Qu\\u00e9bec"}');
  });

  it("integral floats print as integers natively", () => {
    expect(compactJson({ p50: 3585.0, members: 21 })).toBe('{"p50":3585,"members":21}');
  });
});

class FakeDownloadStats {
  requests = 421;
  responseBytes = 9_000_000;
  retries = 3;
}

describe("manifestStats", () => {
  it("publishes exactly the stable core", () => {
    const stats = manifestStats(new FakeDownloadStats(), performance.now() - 1000.0);

    expect(Object.keys(stats)).toEqual(["downloadBytes", "downloads", "durationMs", "retries"]);
    expect(stats.downloadBytes).toBe(9_000_000);
    expect(stats.downloads).toBe(421);
    expect(stats.retries).toBe(3);
    expect(stats.durationMs).toBeGreaterThanOrEqual(1000);
  });
});

function manifest(model: string, referenceTime: string, generatedAt: string): PublishedManifest {
  return {
    model,
    referenceTime,
    generatedAt,
    schemaVersion: 1,
    stats: { downloads: 1 },
  };
}

describe("runs index", () => {
  it("maps each published manifest to its publication identity", () => {
    const manifests: Record<string, PublishedManifest> = {
      gfs: manifest("gfs", "2026-08-08T06:00:00Z", "2026-08-08T12:10:00Z"),
      "hrdps-continental": manifest(
        "hrdps-continental",
        "2026-08-08T12:00:00Z",
        "2026-08-08T16:40:00Z",
      ),
    };

    // geps has never published: absent from the index, never an error.
    const index = runsIndex(["gfs", "hrdps-continental", "geps"], (slug) => manifests[slug]);

    expect(index).toEqual({
      schemaVersion: 1,
      runs: {
        gfs: {
          referenceTime: "2026-08-08T06:00:00Z",
          generatedAt: "2026-08-08T12:10:00Z",
        },
        "hrdps-continental": {
          referenceTime: "2026-08-08T12:00:00Z",
          generatedAt: "2026-08-08T16:40:00Z",
        },
      },
    });
  });

  it("writeRunsIndex regenerates the index wholesale", () => {
    const tmp = mkdtempSync(join(tmpdir(), "runs-index-"));
    const models = join(tmp, "models.json");
    writeJson(models, { models: [{ slug: "reps" }, { slug: "geps" }] }, { compact: true });
    const path = join(tmp, "data", "runs.json");
    const manifests: Record<string, PublishedManifest> = {
      reps: manifest("reps", "2026-08-08T00:00:00Z", "2026-08-08T03:05:00Z"),
    };

    writeRunsIndex((slug) => manifests[slug], path, models);

    const index = JSON.parse(readFileSync(path, "utf-8")) as {
      runs: Record<string, { referenceTime: string }>;
    };
    expect(Object.keys(index.runs)).toEqual(["reps"]);
    expect(index.runs.reps.referenceTime).toBe("2026-08-08T00:00:00Z");
  });

  it("defaults read the packaged catalogue and write the scratch tree", () => {
    // The upload flow calls `meteo forecast runs-index` bare from the
    // checkout root; these defaults are that call's contract: the model
    // list comes from the catalogue the PACKAGE ships (models.json), the
    // index lands at data/runs.json under the working directory.
    const tmp = mkdtempSync(join(tmpdir(), "runs-index-defaults-"));
    const previous = process.cwd();
    process.chdir(tmp);
    try {
      writeRunsIndex((slug) =>
        slug === "gfs" ? manifest("gfs", "2026-08-08T00:00:00Z", "2026-08-08T03:05:00Z") : null,
      );

      const index = JSON.parse(readFileSync(join(tmp, "data", "runs.json"), "utf-8")) as {
        runs: Record<string, unknown>;
      };
      expect(Object.keys(index.runs)).toEqual(["gfs"]);
    } finally {
      process.chdir(previous);
    }
  });

  it("packagedModelsPath resolves the catalogue this package ships", () => {
    // Package-relative (one hop above src/ and dist/ alike), so the
    // installed package and the source checkout read the same file.
    expect(packagedModelsPath().endsWith(join("forecast", "models.json"))).toBe(true);
    const catalogue = JSON.parse(readFileSync(packagedModelsPath(), "utf-8")) as {
      models: { slug: string }[];
    };
    expect(catalogue.models.length).toBeGreaterThan(0);
    expect(cataloguedModelSlugs()).toContain("gfs");
  });

  it("cataloguedModelSlugs reads profile, smoke, and observation datasets", () => {
    const tmp = mkdtempSync(join(tmpdir(), "catalogue-"));
    const models = join(tmp, "models.json");
    writeJson(
      models,
      {
        models: [{ slug: "gfs" }, { slug: "reps" }],
        smokeModels: [{ slug: "hrrr-smoke" }],
        observationModels: [{ slug: "goes18-aod" }],
      },
      { compact: true },
    );

    expect(cataloguedModelSlugs(models)).toEqual(["gfs", "reps", "hrrr-smoke", "goes18-aod"]);
  });
});
