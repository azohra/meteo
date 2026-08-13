import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  datasetIndex,
  landCoverFromWindow,
  mPerDegLon,
  projectPoint,
  projectedPointFromWindow,
  terrainFromWindow,
  M_PER_DEG_LAT,
  type LandCoverBlock,
  type RasterWindow,
  type SitePoint,
  type TerrainBlock,
} from "../src/terrain.js";

interface WindowFixture {
  url: string;
  site: SitePoint;
  halfM: number;
  radiiM: number[];
  dataset: { width: number; height: number; transform: number[]; nodata: number | null };
  window: { row0: number; col0: number; rows: number; cols: number };
  lats: number[];
  lons: number[];
  values: number[];
  maskedIndices: number[];
}

interface ProjectedFixture {
  samples: Array<{
    url: string;
    site: SitePoint;
    crsEpsg: number;
    projected: [number, number];
    dataset: { width: number; height: number; transform: number[]; nodata: number | null };
    window: { row0: number; col0: number; rows: number; cols: number };
    values: number[];
    maskedIndices: number[];
    expected: number | null;
  }>;
  warpTransforms: Array<{ slug: string; epsg: number; x: number; y: number }>;
}

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`fixtures/terrain/${name}`, import.meta.url), "utf-8"),
  ) as T;
}

function mask(fx: { values: number[]; maskedIndices: number[] }): Uint8Array | null {
  if (fx.maskedIndices.length === 0) {
    return null;
  }
  const bits = new Uint8Array(fx.values.length);
  for (const index of fx.maskedIndices) {
    bits[index] = 1;
  }
  return bits;
}

const affine = (transform: number[]) =>
  transform as unknown as readonly [number, number, number, number, number, number];

function placeWindow(fx: WindowFixture): { lats: Float64Array; lons: Float64Array } {
  const transform = affine(fx.dataset.transform);
  const { latitude, longitude } = fx.site;
  const dlat = fx.halfM / M_PER_DEG_LAT;
  const dlon = fx.halfM / mPerDegLon(latitude);
  let [row0, col0] = datasetIndex(transform, longitude - dlon, latitude + dlat);
  let [row1, col1] = datasetIndex(transform, longitude + dlon, latitude - dlat);
  row0 = Math.max(0, row0);
  col0 = Math.max(0, col0);
  row1 = Math.min(fx.dataset.height - 1, row1);
  col1 = Math.min(fx.dataset.width - 1, col1);
  expect([row0, col0]).toEqual([fx.window.row0, fx.window.col0]);
  expect([row1 - row0 + 1, col1 - col0 + 1]).toEqual([fx.window.rows, fx.window.cols]);

  const [a, , c, , e, f] = transform;
  const cWindow = a * col0 + c;
  const fWindow = e * row0 + f;
  const lons = new Float64Array(fx.window.cols);
  for (let j = 0; j < fx.window.cols; j++) {
    lons[j] = cWindow + (j + 0.5) * a;
  }
  const lats = new Float64Array(fx.window.rows);
  for (let i = 0; i < fx.window.rows; i++) {
    lats[i] = fWindow + (i + 0.5) * e;
  }
  expect([...lats]).toEqual(fx.lats);
  expect([...lons]).toEqual(fx.lons);
  return { lats, lons };
}

describe("GLO-30 window fixture (real tile, Python outputs)", () => {
  const fx = fixture<WindowFixture & { expected: TerrainBlock }>("glo30-dundee.json");

  it("places the window and derives the pixel-centre vectors bit-identically", () => {
    placeWindow(fx);
  });

  it("reproduces terrain_from_window on the real window", () => {
    expect(fx.dataset.nodata).toBeNull();
    const window: RasterWindow = {
      values: Float32Array.from(fx.values),
      mask: mask(fx),
      rows: fx.window.rows,
      cols: fx.window.cols,
    };

    const block = terrainFromWindow(window, fx.lats, fx.lons, fx.site, fx.radiiM);

    expect(block.source).toBe(fx.expected.source);
    expect(block.elevationM).toBe(fx.expected.elevationM);
    expect(block.relief.length).toBe(fx.expected.relief.length);
    for (let i = 0; i < block.relief.length; i++) {
      expect(block.relief[i].radiusKm).toBe(fx.expected.relief[i].radiusKm);
      expect(block.relief[i].minM).toBe(fx.expected.relief[i].minM);
      expect(block.relief[i].maxM).toBe(fx.expected.relief[i].maxM);
      expect(block.relief[i].percentile).toBe(fx.expected.relief[i].percentile);
    }
    // Through libm: an ulp of slack.
    expect(block.slopeDeg).toBeCloseTo(fx.expected.slopeDeg, 9);
    expect(block.aspectDeg).toBeCloseTo(fx.expected.aspectDeg, 9);
  });
});

describe("WorldCover window fixture (real tile, Python outputs)", () => {
  const fx = fixture<WindowFixture & { expected: LandCoverBlock }>("worldcover-dundee.json");

  it("places the window and derives the pixel-centre vectors bit-identically", () => {
    placeWindow(fx);
  });

  it("reproduces land_cover_from_window on the real window", () => {
    const window: RasterWindow = {
      values: Uint8Array.from(fx.values),
      mask: mask(fx),
      rows: fx.window.rows,
      cols: fx.window.cols,
    };

    const block = landCoverFromWindow(window, fx.lats, fx.lons, fx.site, fx.radiiM);

    expect(block.source).toBe(fx.expected.source);
    expect(block.atLaunch).toBe(fx.expected.atLaunch);
    expect(block.fractions.length).toBe(fx.expected.fractions.length);
    for (let i = 0; i < block.fractions.length; i++) {
      expect(block.fractions[i].radiusKm).toBe(fx.expected.fractions[i].radiusKm);
      expect(block.fractions[i].byClass).toEqual(fx.expected.fractions[i].byClass);
      expect(Object.keys(block.fractions[i].byClass)).toEqual(
        Object.keys(fx.expected.fractions[i].byClass),
      );
    }
  });
});

describe("projected DTM sampling fixtures (MRDEM-30 + LidarBC, Python outputs)", () => {
  const fx = fixture<ProjectedFixture>("projected-points.json");

  it("proj4 lands on rasterio.warp's coordinates for every catalogued site", () => {
    for (const { slug, epsg, x, y } of fx.warpTransforms) {
      const [px, py] = projectPoint(epsg, siteOf(slug).latitude, siteOf(slug).longitude);
      expect(Math.abs(px - x), `${slug} EPSG:${epsg} x`).toBeLessThan(1e-6);
      expect(Math.abs(py - y), `${slug} EPSG:${epsg} y`).toBeLessThan(1e-6);
    }
  });

  it("reproduces _projected_point on the real 5×5 windows", () => {
    for (const sample of fx.samples) {
      const transform = affine(sample.dataset.transform);
      const [x, y] = sample.projected;
      const [row, col] = datasetIndex(transform, x, y);
      expect([row - 2, col - 2], sample.url).toEqual([sample.window.row0, sample.window.col0]);

      const window: RasterWindow = {
        values: Float32Array.from(sample.values),
        mask: mask(sample),
        rows: 5,
        cols: 5,
      };
      const [a, , c, , e, f] = transform;
      const windowTransform = {
        a,
        c: a * sample.window.col0 + c,
        e,
        f: e * sample.window.row0 + f,
      };
      const elevation = projectedPointFromWindow(window, windowTransform, x, y);
      if (sample.expected === null) {
        expect(elevation, sample.url).toBeNull();
      } else {
        expect(elevation, sample.url).toBe(sample.expected);
      }

      const [px, py] = projectPoint(sample.crsEpsg, sample.site.latitude, sample.site.longitude);
      const viaProj4 = projectedPointFromWindow(window, windowTransform, px, py);
      if (sample.expected === null) {
        expect(viaProj4, sample.url).toBeNull();
      } else {
        expect(viaProj4, sample.url).toBeCloseTo(sample.expected, 6);
      }
    }
  });

  function siteOf(slug: string): SitePoint {
    const site = fx.samples.find((sample) => sample.site.slug === slug)?.site;
    if (site === undefined) {
      throw new Error(`fixture lists no site ${slug}`);
    }
    return site;
  }
});
