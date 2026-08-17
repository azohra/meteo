import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { roundDocument, writeJson } from "../src/publish.js";
import {
  MRDEM30_URL,
  SOURCES,
  buildDocument,
  classFractions,
  discIsCovered,
  discMask,
  glo30Url,
  hornSlopeAspect,
  landCoverFromWindow,
  landCoverName,
  lidarbcCandidates,
  mPerDegLon,
  percentileBelow,
  pickElevation,
  terrainFromWindow,
  worldcoverUrl,
  type ElevationPick,
  type LandCoverBlock,
  type RasterWindow,
  type SiteContextDocument,
  type SitePoint,
  type TerrainBlock,
} from "../src/terrain.js";
import { useCleanWireEnv } from "./helpers/wire.js";

useCleanWireEnv();

const degreesOf = (x: number): number => x / (Math.PI / 180);

// ------------------------------------------------------------- tile keys

describe("tile keys", () => {
  it("glo30 tile urls match the probe-verified names", () => {
    const url = glo30Url(49.291977, -117.183569);
    expect(url).toMatch(
      /Copernicus_DSM_COG_10_N49_00_W118_00_DEM\/Copernicus_DSM_COG_10_N49_00_W118_00_DEM\.tif$/,
    );
    expect(url.startsWith("https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/")).toBe(true);
  });

  it("glo30 tile keys floor both axes at exact integer degrees", () => {
    expect(glo30Url(49.0, -117.0)).toContain("N49_00_W117_00");
    expect(glo30Url(49.5, -117.000001)).toContain("N49_00_W118_00");
    expect(glo30Url(46.5, 8.3)).toContain("N46_00_E008_00");
    expect(glo30Url(-33.9, 18.4)).toContain("S34_00_E018_00");
  });

  it("worldcover tile urls match the probe-verified names", () => {
    const url = worldcoverUrl(49.291977, -117.183569);
    expect(url.endsWith("v200/2021/map/ESA_WorldCover_10m_2021_v200_N48W120_Map.tif")).toBe(true);

    expect(worldcoverUrl(48.0, -120.0)).toContain("N48W120");
    expect(worldcoverUrl(47.999999, -117.000001)).toContain("N45W120");
    expect(worldcoverUrl(46.5, 8.3)).toContain("N45E006");
  });
});

/** A 3×3 north-up window of z = base + gx·east + gy·north. */
function plane(eastGradient: number, northGradient: number, resM: number): number[][] {
  const z: number[][] = [];
  for (let row = 0; row < 3; row++) {
    const line: number[] = [];
    for (let col = 0; col < 3; col++) {
      const east = (col - 1) * resM;
      const north = (1 - row) * resM;
      line.push(1000.0 + eastGradient * east + northGradient * north);
    }
    z.push(line);
  }
  return z;
}

describe("hornSlopeAspect", () => {
  it("measures synthetic inclined planes", () => {
    // Rising to the east — downslope faces west.
    let [slope, aspect] = hornSlopeAspect(plane(0.2, 0.0, 30.0), 30.0, 30.0);
    expect(slope).toBeCloseTo(degreesOf(Math.atan(0.2)), 9);
    expect(aspect).toBeCloseTo(270.0, 9);

    // Rising to the north — downslope faces south.
    [slope, aspect] = hornSlopeAspect(plane(0.0, 0.35, 30.0), 30.0, 30.0);
    expect(slope).toBeCloseTo(degreesOf(Math.atan(0.35)), 9);
    expect(aspect).toBeCloseTo(180.0, 9);

    // Rising to the north-east — downslope faces south-west.
    [slope, aspect] = hornSlopeAspect(plane(0.1, 0.1, 30.0), 30.0, 30.0);
    expect(slope).toBeCloseTo(degreesOf(Math.atan(Math.hypot(0.1, 0.1))), 9);
    expect(aspect).toBeCloseTo(225.0, 9);
  });

  it("is zero on a flat plane", () => {
    const [slope] = hornSlopeAspect(plane(0.0, 0.0, 30.0), 30.0, 30.0);
    expect(slope).toBe(0.0);
  });

  it("uses anisotropic metre spacings", () => {
    const z = plane(0.2, 0.0, 30.0);
    const [steep] = hornSlopeAspect(z, 15.0, 30.0);
    const [shallow] = hornSlopeAspect(z, 30.0, 30.0);
    expect(steep).toBeCloseTo(degreesOf(Math.atan(0.4)), 9);
    expect(shallow).toBeCloseTo(degreesOf(Math.atan(0.2)), 9);
  });
});

describe("disc statistics", () => {
  it("disc membership follows the pixel-centre rule", () => {
    // At 240 m radius the two-step diagonals (~248.7 m) sit outside; the
    // two-step axials (~222 m) inside.
    const lats = Array.from({ length: 5 }, (_, i) => 0.002 - i * 0.001);
    const lons = Array.from({ length: 5 }, (_, j) => -0.002 + j * 0.001);
    const inside = discMask(lats, lons, 0.0, 0.0, 240.0);
    expect(inside.reduce((sum, bit) => sum + bit, 0)).toBe(13);
    expect(inside[2 * 5 + 2]).toBe(1);
    expect(inside[2 * 5 + 0]).toBe(1);
    // eslint-disable-next-line oxc/erasing-op
    expect(inside[0 * 5 + 2]).toBe(1);
    // eslint-disable-next-line oxc/erasing-op
    expect(inside[0 * 5 + 0]).toBe(0);
    expect(inside[1 * 5 + 4]).toBe(0);
  });

  it("percentile rank on a ramp", () => {
    const ramp = Float64Array.from({ length: 101 }, (_, i) => i);
    expect(percentileBelow(ramp, 50.0)).toBeCloseTo(50.0, 9);
    expect(percentileBelow(ramp, 200.0)).toBe(100.0);
    expect(percentileBelow(ramp, -5.0)).toBe(0.0);
    expect(percentileBelow(new Float64Array(40).fill(7.0), 7.0)).toBe(50.0);
  });
});

/**
 * A synthetic GLO-30-like window: elevation a pure ramp eastward, built
 * with the same equirectangular scaling the analysis uses.
 */
function rampWindow(
  spacingDeg = 0.0005,
  size = 61,
  latitude = 49.0,
  longitude = -117.0,
): { window: RasterWindow; lats: number[]; lons: number[] } {
  const half = Math.floor(size / 2);
  const lats = Array.from({ length: size }, (_, i) => latitude + (half - i) * spacingDeg);
  const lons = Array.from({ length: size }, (_, j) => longitude + (j - half) * spacingDeg);
  const values = new Float64Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const eastM = (lons[j] - longitude) * mPerDegLon(latitude);
      values[i * size + j] = 1000.0 + 0.2 * eastM;
    }
  }
  return {
    window: { values, mask: new Uint8Array(size * size), rows: size, cols: size },
    lats,
    lons,
  };
}

describe("terrainFromWindow", () => {
  const site: SitePoint = { slug: "ramp", latitude: 49.0, longitude: -117.0 };

  it("analyses a synthetic ramp", () => {
    const { window, lats, lons } = rampWindow();

    const block = terrainFromWindow(window, lats, lons, site, [500, 1000]);

    expect(block.source).toBe("glo30");
    expect(block.elevationM).toBeCloseTo(1000.0, 6);
    expect(block.slopeDeg).toBeCloseTo(degreesOf(Math.atan(0.2)), 6);
    expect(block.aspectDeg).toBeCloseTo(270.0, 6);
    expect(block.relief.map((entry) => entry.radiusKm)).toEqual([0.5, 1.0]);
    const disc = block.relief[0];
    expect(disc.minM).toBeLessThan(1000.0);
    expect(disc.maxM).toBeGreaterThan(1000.0);
    // Whether the centre column counts as ties or "above" hangs on float
    // epsilon in the bilinear, worth a couple of percent on a disc this small.
    expect(Math.abs(disc.percentile - 50.0)).toBeLessThanOrEqual(3.0);
  });

  it("fails loudly when a disc is truncated by the window edge", () => {
    // The window reaches ~1095 m east-west of the site.
    const { window, lats, lons } = rampWindow();

    expect(discIsCovered(lats, lons, 49.0, -117.0, 1000.0)).toBe(true);
    expect(discIsCovered(lats, lons, 49.0, -117.0, 1200.0)).toBe(false);
    expect(() => terrainFromWindow(window, lats, lons, site, [1200])).toThrowError(
      /crosses the GLO-30 tile edge/,
    );
  });

  it("fails loudly on nodata at the point", () => {
    const { window, lats, lons } = rampWindow();
    for (let i = 29; i < 32; i++) {
      for (let j = 29; j < 32; j++) {
        (window.mask as Uint8Array)[i * window.cols + j] = 1;
      }
    }

    expect(() => terrainFromWindow(window, lats, lons, site, [500])).toThrowError(
      /GLO-30 returned nodata/,
    );
  });
});

describe("classFractions", () => {
  it("sums to one and omits absent classes", () => {
    const values = [...Array(97).fill(10), ...Array(2).fill(30), 60];

    const fractions = classFractions(values);

    expect(fractions).toEqual({ treeCover: 0.97, grassland: 0.02, bareSparse: 0.01 });
    const total = Object.values(fractions).reduce((sum, f) => sum + f, 0);
    expect(total).toBeCloseTo(1.0, 9);
    expect(Object.keys(fractions)).toEqual(["treeCover", "grassland", "bareSparse"]);
  });

  it("omits traces that would publish as zero", () => {
    const values = [...Array(9999).fill(10), 80];
    const fractions = classFractions(values);
    expect(Object.keys(fractions)).toEqual(["treeCover"]);
    expect(fractions.treeCover).toBeCloseTo(0.9999, 9);
    expect(() => classFractions([...Array(9999).fill(10), 42])).toThrowError(/class code 42/);
  });

  it("excludes nodata from the denominator", () => {
    expect(classFractions([10, 10, 10, 0, 0, 80])).toEqual({ treeCover: 0.75, water: 0.25 });
    expect(() => classFractions(Array(9).fill(0))).toThrowError(/only nodata/);
  });

  it("treats an unknown land-cover code as a hard failure", () => {
    expect(() => classFractions([10, 42])).toThrowError(/class code 42/);
    expect(() => landCoverName(255)).toThrowError(/class code 255/);
  });
});

describe("landCoverFromWindow", () => {
  it("reads the launch pixel and discs", () => {
    const size = 41;
    const half = Math.floor(size / 2);
    const lats = Array.from({ length: size }, (_, i) => 49.0 + (half - i) * 0.0005);
    const lons = Array.from({ length: size }, (_, j) => -117.0 + (j - half) * 0.0005);
    const values = new Uint8Array(size * size).fill(10);
    values[half * size + half] = 30;
    const window: RasterWindow = { values, mask: null, rows: size, cols: size };

    const block = landCoverFromWindow(
      window,
      lats,
      lons,
      { slug: "clearing", latitude: 49.0, longitude: -117.0 },
      [500],
    );

    expect(block.source).toBe("worldcover2021");
    expect(block.atLaunch).toBe("grassland");
    const byClass = block.fractions[0].byClass;
    expect(Object.keys(byClass).sort()).toEqual(["grassland", "treeCover"]);
    expect(byClass.treeCover).toBeGreaterThan(0.9);
  });

  it("treats nodata at the launch as a hard failure", () => {
    const lats = Array.from({ length: 3 }, (_, i) => 49.0005 - i * 0.0005);
    const lons = Array.from({ length: 3 }, (_, j) => -117.0005 + j * 0.0005);
    const window: RasterWindow = { values: new Uint8Array(9), mask: null, rows: 3, cols: 3 };

    expect(() =>
      landCoverFromWindow(
        window,
        lats,
        lons,
        { slug: "void", latitude: 49.0, longitude: -117.0 },
        [100],
      ),
    ).toThrowError(/WorldCover returned nodata/);
  });
});

const LIDARBC_RESPONSE = {
  objectIdFieldName: "OBJECTID",
  features: [
    {
      attributes: {
        OBJECTID: 300,
        filename: "bc_082f025_xli1m_utm11_2017.tif",
        maptile: "082f025",
        year: 2017,
        projection: "utm11",
        s3Url:
          "https://nrs.objectstore.gov.bc.ca/gdwuts/082/082f/2017/dem/bc_082f025_xli1m_utm11_2017.tif",
      },
    },
    {
      attributes: {
        OBJECTID: 301,
        filename: "bc_082f025_xli1m_utm11_2022.tif",
        maptile: "082f025",
        year: 2022,
        projection: "utm11",
        s3Url:
          "https://nrs.objectstore.gov.bc.ca/gdwuts/082/082f/2022/dem/bc_082f025_xli1m_utm11_2022.tif",
      },
    },
  ],
};

describe("lidarbcCandidates", () => {
  it("prefers the newest acquisition", () => {
    const urls = lidarbcCandidates(LIDARBC_RESPONSE);
    expect(urls.map((url) => url.split("/").pop())).toEqual([
      "bc_082f025_xli1m_utm11_2022.tif",
      "bc_082f025_xli1m_utm11_2017.tif",
    ]);
  });

  it("tolerates empty and incomplete responses", () => {
    expect(lidarbcCandidates({ features: [] })).toEqual([]);
    expect(lidarbcCandidates({})).toEqual([]);
    expect(lidarbcCandidates({ features: [{ attributes: { year: 2020 } }] })).toEqual([]);
  });
});

const SITES: SitePoint[] = [
  { slug: "dundee", latitude: 49.291977, longitude: -117.183569 },
  { slug: "erie", latitude: 49.204789, longitude: -117.406951 },
];

function terrainBlock(site: SitePoint): TerrainBlock {
  // Unrounded floats; dundee's aspect sits at the north wrap.
  const aspect = site.slug === "dundee" ? 359.7 : 236.4;
  const elevation = site.slug === "dundee" ? 1492.0666 : 1254.0666;
  return {
    source: "glo30",
    elevationM: elevation,
    slopeDeg: 18.3399,
    aspectDeg: aspect,
    relief: [
      { radiusKm: 1.0, minM: 895.5, maxM: 1665.9, percentile: 80.4 },
      { radiusKm: 3.0, minM: 713.4, maxM: 1916.1, percentile: 78.7 },
    ],
  };
}

function elevationBlock(site: SitePoint): ElevationPick | null {
  if (site.slug === "dundee") {
    return null;
  }
  return { source: "lidarbc", elevationM: 1245.7789 };
}

function landCoverBlock(): LandCoverBlock {
  return {
    source: "worldcover2021",
    atLaunch: "grassland",
    fractions: [
      {
        radiusKm: 1.0,
        byClass: { treeCover: 0.96994, grassland: 0.0291, bareSparse: 0.00096 },
      },
    ],
  };
}

interface CapturedBuild {
  document: SiteContextDocument;
  out: string[];
  err: string[];
}

async function builtDocument(
  sites: SitePoint[] = SITES,
  elevationOf: (site: SitePoint) => ElevationPick | null = elevationBlock,
): Promise<CapturedBuild> {
  const out: string[] = [];
  const err: string[] = [];
  const document = await buildDocument(sites, {
    terrainOf: terrainBlock,
    elevationOf,
    landCoverOf: landCoverBlock,
    generatedAt: "2026-08-10T08:00:00Z",
    log: (line) => out.push(line),
    warn: (line) => err.push(line),
  });
  return { document, out, err };
}

describe("buildDocument", () => {
  it("round-trips through the published contract", async () => {
    const { document, out, err } = await builtDocument();
    const path = join(mkdtempSync(join(tmpdir(), "terrain-")), "site-context.json");
    writeJson(path, roundDocument(document), { compact: false });
    const published = JSON.parse(readFileSync(path, "utf-8")) as SiteContextDocument;

    const schema = JSON.parse(
      readFileSync(
        new URL(import.meta.resolve("@azohra/meteo.briefing/schema/site-context.schema.json")),
        "utf-8",
      ),
    ) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const validate = ajv.compile(schema);
    expect(validate(published), JSON.stringify(validate.errors)).toBe(true);

    expect(published.schemaVersion).toBe(3);
    const dundee = published.sites.dundee;
    // The measured point echoes the catalogue verbatim — never rounded, so
    // the staleness test's exact equality holds.
    expect(dundee.point).toEqual({ latitude: 49.291977, longitude: -117.183569 });
    expect(dundee.terrain.elevationM).toBe(1492.1);
    expect(dundee.terrain.slopeDeg).toBe(18.3);
    expect(dundee.terrain.aspectDeg).toBe(0); // 359.7 wraps to 0
    expect(Number.isInteger(dundee.terrain.aspectDeg)).toBe(true);
    expect(dundee.terrain.relief[0]).toEqual({
      radiusKm: 1,
      minM: 896,
      maxM: 1666,
      percentile: 80,
    });
    expect(dundee.landCover.fractions[0].byClass).toEqual({
      treeCover: 0.97,
      grassland: 0.029,
      bareSparse: 0.001,
    });
    expect(dundee.elevation).toEqual({ source: "glo30", elevationM: 1492.1 });
    expect(published.sites.erie.elevation).toEqual({ source: "lidarbc", elevationM: 1245.8 });
    expect("bareEarth" in dundee).toBe(false);
    expect("bareEarth" in published.sites.erie).toBe(false);
    const stderr = err.join("\n");
    expect(stderr).toContain("WARN dundee");
    expect(stderr).toContain("falls back to the GLO-30 surface model");
    const stdout = out.join("\n");
    expect(stdout).toContain("dundee: 1492.1 m (glo30)");
    expect(stdout).toContain("erie: 1245.8 m (lidarbc)");
  });

  it("lists exactly the referenced sources", async () => {
    const { document } = await builtDocument();

    expect(document.sources.map((source) => source.id)).toEqual([
      "glo30",
      "lidarbc",
      "worldcover2021",
    ]);
    for (const source of document.sources) {
      expect(source).toEqual(SOURCES[source.id]);
    }
  });

  it("warns on a cross-source disagreement but does not fail", async () => {
    const { document, err } = await builtDocument([SITES[0]], () => ({
      source: "lidarbc",
      elevationM: 985.0,
    }));

    expect(document.sites.dundee.elevation.elevationM).toBe(985.0);
    const stderr = err.join("\n");
    expect(stderr).toContain("WARN dundee");
    expect(stderr).toContain("different terrain");
  });

  it("does not warn on a close cross-source agreement", async () => {
    const { err } = await builtDocument([SITES[1]]);
    expect(err).toEqual([]);
  });
});

describe("pickElevation", () => {
  it("prefers lidarbc, then mrdem, then defers", async () => {
    const lidarbc = ["https://example.test/tile-2022.tif", "https://example.test/tile-2017.tif"];

    expect(
      await pickElevation(async (url) => (url === lidarbc[0] ? 1245.7 : null), lidarbc),
    ).toEqual({ source: "lidarbc", elevationM: 1245.7 });

    expect(
      await pickElevation(async (url) => (url === lidarbc[1] ? 1246.2 : null), lidarbc),
    ).toEqual({ source: "lidarbc", elevationM: 1246.2 });

    expect(
      await pickElevation(async (url) => (url === MRDEM30_URL ? 1476.4 : null), lidarbc),
    ).toEqual({ source: "mrdem30", elevationM: 1476.4 });

    expect(await pickElevation(async () => null, lidarbc)).toBeNull();
  });
});
