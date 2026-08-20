import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fromUrl } from "geotiff";
import proj4 from "proj4";

import { SITE_CONTEXT_SCHEMA_VERSION } from "@azohra/meteo.briefing/contract";
import { roundContract, roundDocument, writeJson } from "./publish.js";
import { REQUEST_TIMEOUT_S, USER_AGENT, type TransportFetch } from "./providers/transport.js";

export const RELIEF_RADII_M: readonly number[] = [1_000, 3_000, 10_000];
export const LAND_COVER_RADII_M: readonly number[] = [1_000, 3_000];

export const M_PER_DEG_LAT = 111_132.0;

export const CROSS_SOURCE_DISAGREEMENT_WARN_M = 100.0;

export const GLO30_ID = "glo30";
export const LIDARBC_ID = "lidarbc";
export const MRDEM30_ID = "mrdem30";
export const WORLDCOVER_ID = "worldcover2021";

export interface SourceEntry {
  id: string;
  product: string;
  kind: string;
  resolutionM: number;
  licence: string;
  attribution: string;
  url: string;
}

// The attribution strings are what each licence requires to travel with the data.
export const SOURCES: Record<string, SourceEntry> = {
  [GLO30_ID]: {
    id: GLO30_ID,
    product: "Copernicus GLO-30 DEM",
    kind: "surfaceModel",
    resolutionM: 30,
    licence: "Copernicus DEM licence",
    attribution:
      "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and " +
      "© Airbus Defence and Space GmbH 2014-2018 provided under " +
      "COPERNICUS by the European Union and ESA; all rights reserved",
    url: "https://registry.opendata.aws/copernicus-dem/",
  },
  [LIDARBC_ID]: {
    id: LIDARBC_ID,
    product: "LidarBC 1 m bare-earth DEM",
    kind: "bareEarthModel",
    resolutionM: 1,
    licence: "OGL-BC",
    attribution:
      "Contains information licensed under the Open Government Licence – British Columbia.",
    url: "https://lidar.gov.bc.ca",
  },
  [MRDEM30_ID]: {
    id: MRDEM30_ID,
    product: "NRCan MRDEM 30 m DTM (CanElevation)",
    kind: "bareEarthModel",
    resolutionM: 30,
    licence: "OGL-Canada",
    attribution: "Contains information licensed under the Open Government Licence – Canada.",
    url: "https://registry.opendata.aws/canelevation-dem/",
  },
  [WORLDCOVER_ID]: {
    id: WORLDCOVER_ID,
    product: "ESA WorldCover 10 m 2021 v200",
    kind: "landCover",
    resolutionM: 10,
    licence: "CC-BY 4.0",
    attribution:
      "© ESA WorldCover project 2021 / Contains modified Copernicus " +
      "Sentinel data (2021) processed by ESA WorldCover consortium",
    url: "https://zenodo.org/records/7254221",
  },
};

export const LAND_COVER_CLASSES: Record<number, string> = {
  10: "treeCover",
  20: "shrubland",
  30: "grassland",
  40: "cropland",
  50: "builtUp",
  60: "bareSparse",
  70: "snowIce",
  80: "water",
  90: "wetland",
  95: "mangroves",
  100: "mossLichen",
};

export const MRDEM30_URL =
  "https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif";
export const LIDARBC_QUERY_URL =
  "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/" +
  "LiDAR_BC_S3_Public/FeatureServer/6/query";

// EPSG:1946 with the rotation signs flipped: proj4's +towgs84 speaks the
// Position Vector convention where EPSG registers a Coordinate Frame rotation.
const NAD83_CSRS_TOWGS84 =
  "+towgs84=-0.991,1.9072,0.5129,0.0257899075194932,0.0096500989602704,0.0116599432323421,0";

const nad83CsrsUtm = (zone: number): string =>
  `+proj=utm +zone=${zone} +ellps=GRS80 ${NAD83_CSRS_TOWGS84} +units=m +no_defs`;

export const PROJECTED_CRS: Record<number, string> = {
  3979:
    "+proj=lcc +lat_1=49 +lat_2=77 +lat_0=49 +lon_0=-95 +x_0=0 +y_0=0 " +
    `+ellps=GRS80 ${NAD83_CSRS_TOWGS84} +units=m +no_defs`,
  3154: nad83CsrsUtm(7),
  3155: nad83CsrsUtm(8),
  3156: nad83CsrsUtm(9),
  3157: nad83CsrsUtm(10),
  2955: nad83CsrsUtm(11),
};

export function projectPoint(epsg: number, latitude: number, longitude: number): [number, number] {
  const definition = PROJECTED_CRS[epsg];
  if (definition === undefined) {
    throw new Error(
      `no proj4 definition for EPSG:${epsg} — a DTM source changed its CRS; ` +
        "add the definition to PROJECTED_CRS after verifying it against PROJ",
    );
  }
  const [x, y] = proj4("EPSG:4326", definition, [longitude, latitude]);
  return [x, y];
}

function hemisphere(degrees: number, positive: string, negative: string, width: number): string {
  const prefix = degrees >= 0 ? positive : negative;
  return `${prefix}${String(Math.abs(degrees)).padStart(width, "0")}`;
}

export function glo30Url(latitude: number, longitude: number): string {
  const stem =
    "Copernicus_DSM_COG_10_" +
    `${hemisphere(Math.floor(latitude), "N", "S", 2)}_00_` +
    `${hemisphere(Math.floor(longitude), "E", "W", 3)}_00_DEM`;
  return `https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/${stem}/${stem}.tif`;
}

export function worldcoverUrl(latitude: number, longitude: number): string {
  const stem =
    "ESA_WorldCover_10m_2021_v200_" +
    `${hemisphere(3 * Math.floor(latitude / 3), "N", "S", 2)}` +
    `${hemisphere(3 * Math.floor(longitude / 3), "E", "W", 3)}_Map`;
  return `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${stem}.tif`;
}

export interface SitePoint {
  slug: string;
  latitude: number;
  longitude: number;
}

export interface RasterWindow {
  values: Float32Array | Float64Array | Uint8Array;
  mask: Uint8Array | null;
  rows: number;
  cols: number;
}

const isMasked = (window: RasterWindow, row: number, col: number): boolean =>
  window.mask !== null && window.mask[row * window.cols + col] === 1;

export function mPerDegLon(latitude: number): number {
  return 111_320.0 * Math.cos(latitude * (Math.PI / 180));
}

// x/(π/180) and x*(180/π) can differ in the last ulp; the committed
// terrain analyses pin this spelling.
const degrees = (x: number): number => x / (Math.PI / 180);

export function bilinear(
  window: RasterWindow,
  lats: ArrayLike<number>,
  lons: ArrayLike<number>,
  latitude: number,
  longitude: number,
): number | null {
  const fx = (longitude - lons[0]) / (lons[1] - lons[0]);
  const fy = (latitude - lats[0]) / (lats[1] - lats[0]);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (y0 < 0 || x0 < 0 || y0 + 1 >= window.rows || x0 + 1 >= window.cols) {
    return null;
  }
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      if (isMasked(window, y0 + dy, x0 + dx)) {
        return null;
      }
    }
  }
  const q00 = window.values[y0 * window.cols + x0];
  const q01 = window.values[y0 * window.cols + x0 + 1];
  const q10 = window.values[(y0 + 1) * window.cols + x0];
  const q11 = window.values[(y0 + 1) * window.cols + x0 + 1];
  const tx = fx - x0;
  const ty = fy - y0;
  return q00 * (1 - tx) * (1 - ty) + q01 * tx * (1 - ty) + q10 * (1 - tx) * ty + q11 * tx * ty;
}

// Horn (1981) 3x3 slope and downslope-aspect stencil.
export function hornSlopeAspect(
  z: ReadonlyArray<ReadonlyArray<number>>,
  xresM: number,
  yresM: number,
): [number, number] {
  const [[a, b, c], [d, , f], [g, h, i]] = z as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  const east = (c + 2 * f + i - (a + 2 * d + g)) / (8 * xresM);
  const north = (a + 2 * b + c - (g + 2 * h + i)) / (8 * yresM);
  const slope = degrees(Math.atan(Math.hypot(east, north)));
  const aspect = (degrees(Math.atan2(-east, -north)) + 360.0) % 360.0;
  return [slope, aspect];
}

export function discMask(
  lats: ArrayLike<number>,
  lons: ArrayLike<number>,
  latitude: number,
  longitude: number,
  radiusM: number,
): Uint8Array {
  const scale = mPerDegLon(latitude);
  const rows = lats.length;
  const cols = lons.length;
  const dx = new Float64Array(cols);
  for (let j = 0; j < cols; j++) {
    dx[j] = (lons[j] - longitude) * scale;
  }
  const mask = new Uint8Array(rows * cols);
  const radiusSq = radiusM * radiusM;
  for (let i = 0; i < rows; i++) {
    const dy = (lats[i] - latitude) * M_PER_DEG_LAT;
    const dySq = dy * dy;
    for (let j = 0; j < cols; j++) {
      if (dx[j] * dx[j] + dySq <= radiusSq) {
        mask[i * cols + j] = 1;
      }
    }
  }
  return mask;
}

export function discIsCovered(
  lats: ArrayLike<number>,
  lons: ArrayLike<number>,
  latitude: number,
  longitude: number,
  radiusM: number,
): boolean {
  const resLat = Math.abs(lats[1] - lats[0]);
  const resLon = Math.abs(lons[1] - lons[0]);
  const radiusDlat = radiusM / M_PER_DEG_LAT;
  const radiusDlon = radiusM / mPerDegLon(latitude);
  return (
    lats[0] + resLat - latitude > radiusDlat &&
    latitude - (lats[lats.length - 1] - resLat) > radiusDlat &&
    longitude - (lons[0] - resLon) > radiusDlon &&
    lons[lons.length - 1] + resLon - longitude > radiusDlon
  );
}

// The point is compared in the array's dtype: a float32 disc casts it first,
// which can turn a strictly-below float64 comparison into a tie.
export function percentileBelow(values: ArrayLike<number>, pointElevation: number): number {
  const point = values instanceof Float32Array ? Math.fround(pointElevation) : pointElevation;
  let below = 0;
  let ties = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < point) {
      below += 1;
    } else if (values[i] === point) {
      ties += 1;
    }
  }
  return (100.0 * (below + 0.5 * ties)) / values.length;
}

export function landCoverName(code: number): string {
  const name = LAND_COVER_CLASSES[code];
  if (name === undefined) {
    throw new Error(
      `WorldCover published class code ${code}, which is not in the ` +
        "v200 taxonomy — refusing to guess what it means",
    );
  }
  return name;
}

export function classFractions(values: ArrayLike<number>): Record<string, number> {
  const counts = new Map<number, number>();
  let size = 0;
  for (let i = 0; i < values.length; i++) {
    const code = values[i];
    if (code === 0) {
      continue;
    }
    size += 1;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  if (size === 0) {
    throw new Error(
      "land-cover disc contains only nodata — WorldCover is " +
        "wall-to-wall, so the coordinates are likely wrong",
    );
  }
  const names = new Map<number, string>();
  for (const code of counts.keys()) {
    names.set(code, landCoverName(code));
  }
  const ranked = [...counts.entries()].sort(([codeA, countA], [codeB, countB]) =>
    countA === countB ? codeA - codeB : countB - countA,
  );
  const fractions: Record<string, number> = {};
  for (const [code, count] of ranked) {
    const fraction = count / size;
    if (roundContract(fraction, 3) > 0) {
      fractions[names.get(code) as string] = fraction;
    }
  }
  return fractions;
}

export interface ReliefDisc {
  radiusKm: number;
  minM: number;
  maxM: number;
  percentile: number;
}

export interface TerrainBlock {
  source: string;
  elevationM: number;
  slopeDeg: number;
  aspectDeg: number;
  relief: ReliefDisc[];
}

export interface ElevationPick {
  source: string;
  elevationM: number;
}

export interface LandCoverBlock {
  source: string;
  atLaunch: string;
  fractions: Array<{ radiusKm: number; byClass: Record<string, number> }>;
}

function discValues(window: RasterWindow, disc: Uint8Array): RasterWindow["values"] {
  let count = 0;
  for (let i = 0; i < disc.length; i++) {
    if (disc[i] === 1 && !(window.mask !== null && window.mask[i] === 1)) {
      count += 1;
    }
  }
  const values = new (window.values.constructor as new (length: number) => RasterWindow["values"])(
    count,
  );
  let cursor = 0;
  for (let i = 0; i < disc.length; i++) {
    if (disc[i] === 1 && !(window.mask !== null && window.mask[i] === 1)) {
      values[cursor] = window.values[i];
      cursor += 1;
    }
  }
  return values;
}

export function terrainFromWindow(
  window: RasterWindow,
  lats: ArrayLike<number>,
  lons: ArrayLike<number>,
  site: SitePoint,
  radiiM: readonly number[] = RELIEF_RADII_M,
): TerrainBlock {
  const { latitude, longitude } = site;
  const elevation = bilinear(window, lats, lons, latitude, longitude);
  if (elevation === null) {
    throw new Error(
      `${site.slug}: GLO-30 returned nodata at ` +
        `${latitude}, ${longitude} — check the catalogued coordinates`,
    );
  }

  const row = roundContract((latitude - lats[0]) / (lats[1] - lats[0]), 0);
  const col = roundContract((longitude - lons[0]) / (lons[1] - lons[0]), 0);
  let neighbourhoodOk =
    row - 1 >= 0 && row + 1 < window.rows && col - 1 >= 0 && col + 1 < window.cols;
  if (neighbourhoodOk) {
    for (let dy = -1; dy <= 1 && neighbourhoodOk; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (isMasked(window, row + dy, col + dx)) {
          neighbourhoodOk = false;
          break;
        }
      }
    }
  }
  if (!neighbourhoodOk) {
    throw new Error(
      `${site.slug}: GLO-30 has nodata in the slope neighbourhood at ` +
        `${latitude}, ${longitude} — check the catalogued coordinates`,
    );
  }
  const xresM = Math.abs(lons[1] - lons[0]) * mPerDegLon(latitude);
  const yresM = Math.abs(lats[1] - lats[0]) * M_PER_DEG_LAT;
  const neighbourhood = [-1, 0, 1].map((dy) =>
    [-1, 0, 1].map((dx) => window.values[(row + dy) * window.cols + (col + dx)]),
  );
  const [slope, aspect] = hornSlopeAspect(neighbourhood, xresM, yresM);

  const relief: ReliefDisc[] = [];
  for (const radiusM of radiiM) {
    if (!discIsCovered(lats, lons, latitude, longitude, radiusM)) {
      throw new Error(
        `${site.slug}: the ${radiusM / 1000} km relief disc crosses ` +
          "the GLO-30 tile edge; stitching neighbouring tiles is not " +
          "implemented",
      );
    }
    const values = discValues(window, discMask(lats, lons, latitude, longitude, radiusM));
    if (values.length === 0) {
      throw new Error(
        `${site.slug}: the ${radiusM / 1000} km relief disc has no ` +
          "GLO-30 data — check the catalogued coordinates",
      );
    }
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      if (values[i] < min) {
        min = values[i];
      }
      if (values[i] > max) {
        max = values[i];
      }
    }
    relief.push({
      radiusKm: radiusM / 1000,
      minM: min,
      maxM: max,
      percentile: percentileBelow(values, elevation),
    });
  }
  return {
    source: GLO30_ID,
    elevationM: elevation,
    slopeDeg: slope,
    aspectDeg: aspect,
    relief,
  };
}

export function landCoverFromWindow(
  window: RasterWindow,
  lats: ArrayLike<number>,
  lons: ArrayLike<number>,
  site: SitePoint,
  radiiM: readonly number[] = LAND_COVER_RADII_M,
): LandCoverBlock {
  const { latitude, longitude } = site;
  const row = roundContract((latitude - lats[0]) / (lats[1] - lats[0]), 0);
  const col = roundContract((longitude - lons[0]) / (lons[1] - lons[0]), 0);
  const launch = window.values[row * window.cols + col];
  if (launch === undefined) {
    throw new Error(`${site.slug}: the launch pixel lies outside the WorldCover window`);
  }
  const code = isMasked(window, row, col) ? 0 : launch;
  if (code === 0) {
    throw new Error(
      `${site.slug}: WorldCover returned nodata at ` +
        `${latitude}, ${longitude} — check the catalogued coordinates`,
    );
  }
  const fractions: LandCoverBlock["fractions"] = [];
  for (const radiusM of radiiM) {
    if (!discIsCovered(lats, lons, latitude, longitude, radiusM)) {
      throw new Error(
        `${site.slug}: the ${radiusM / 1000} km land-cover disc ` +
          "crosses the WorldCover tile edge; stitching neighbouring " +
          "tiles is not implemented",
      );
    }
    const disc = discMask(lats, lons, latitude, longitude, radiusM);
    const values: number[] = [];
    for (let i = 0; i < disc.length; i++) {
      if (disc[i] === 1) {
        values.push(window.mask !== null && window.mask[i] === 1 ? 0 : window.values[i]);
      }
    }
    fractions.push({ radiusKm: radiusM / 1000, byClass: classFractions(values) });
  }
  return {
    source: WORLDCOVER_ID,
    atLaunch: landCoverName(code),
    fractions,
  };
}

export interface LidarbcAttributes {
  year?: number | null;
  s3Url?: string | null;
  [extra: string]: unknown;
}

export interface LidarbcPayload {
  features?: Array<{ attributes?: LidarbcAttributes | null }> | null;
  error?: unknown;
  [extra: string]: unknown;
}

export function lidarbcCandidates(payload: LidarbcPayload): string[] {
  const attributes = (payload.features ?? []).map((feature) => feature.attributes ?? {});
  return attributes
    .filter((entry) => entry.s3Url)
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
    .map((entry) => entry.s3Url as string);
}

export async function pickElevation(
  pointOf: (url: string) => Promise<number | null>,
  lidarbcUrls: readonly string[],
): Promise<ElevationPick | null> {
  for (const url of lidarbcUrls) {
    const elevation = await pointOf(url);
    if (elevation !== null) {
      return { source: LIDARBC_ID, elevationM: elevation };
    }
  }
  const elevation = await pointOf(MRDEM30_URL);
  if (elevation !== null) {
    return { source: MRDEM30_ID, elevationM: elevation };
  }
  return null;
}

export interface SiteContextDocument {
  schemaVersion: number;
  generatedAt: string;
  sources: SourceEntry[];
  sites: Record<
    string,
    {
      point: { latitude: number; longitude: number };
      elevation: ElevationPick;
      terrain: TerrainBlock;
      landCover: LandCoverBlock;
    }
  >;
}

export interface BuildDocumentOptions {
  terrainOf: (site: SitePoint) => TerrainBlock | Promise<TerrainBlock>;
  elevationOf: (site: SitePoint) => ElevationPick | null | Promise<ElevationPick | null>;
  landCoverOf: (site: SitePoint) => LandCoverBlock | Promise<LandCoverBlock>;
  generatedAt: string;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

export async function buildDocument(
  sites: readonly SitePoint[],
  {
    terrainOf,
    elevationOf,
    landCoverOf,
    generatedAt,
    log = console.log,
    warn = console.error,
  }: BuildDocumentOptions,
): Promise<SiteContextDocument> {
  const entries: SiteContextDocument["sites"] = {};
  const referenced = new Set<string>();
  for (const site of sites) {
    const slug = site.slug;
    const terrain = await terrainOf(site);
    let elevation = await elevationOf(site);
    if (elevation === null) {
      elevation = { source: GLO30_ID, elevationM: terrain.elevationM };
      warn(
        `WARN ${slug}: no bare-earth model measures this point; the ` +
          "elevation pick falls back to the GLO-30 surface model " +
          `(${terrain.elevationM.toFixed(1)} m, canopy included)`,
      );
    }
    const landCover = await landCoverOf(site);
    // The catalogue point, echoed verbatim (never rounded): staleness is
    // exact equality against sites.json, so a rounded echo would read as a
    // permanently moved point.
    entries[slug] = {
      point: { latitude: site.latitude, longitude: site.longitude },
      elevation,
      terrain,
      landCover,
    };
    referenced.add(elevation.source);
    referenced.add(terrain.source);
    referenced.add(landCover.source);

    const gap = elevation.elevationM - terrain.elevationM;
    if (Math.abs(gap) > CROSS_SOURCE_DISAGREEMENT_WARN_M) {
      warn(
        `WARN ${slug}: the elevation pick (${elevation.source} ` +
          `${elevation.elevationM.toFixed(1)} m) sits ${gap >= 0 ? "+" : ""}${gap.toFixed(1)} m ` +
          `from the GLO-30 terrain elevation ${terrain.elevationM.toFixed(1)} m — the ` +
          "catalogued pin may hit different terrain in different sources",
      );
    }
    log(
      `${slug}: ${elevation.elevationM.toFixed(1)} m (${elevation.source}), ` +
        `terrain ${terrain.elevationM.toFixed(1)} m, ` +
        `slope ${terrain.slopeDeg.toFixed(1)}° aspect ` +
        `${roundContract(terrain.aspectDeg, 0) % 360}°, ${landCover.atLaunch}`,
    );
  }
  return {
    schemaVersion: SITE_CONTEXT_SCHEMA_VERSION,
    generatedAt,
    sources: Object.keys(SOURCES)
      .filter((sourceId) => referenced.has(sourceId))
      .map((sourceId) => SOURCES[sourceId]),
    sites: entries,
  };
}

export interface CogDataset {
  width: number;
  height: number;
  /** North-up affine (a, b, c, d, e, f): x = a·col + b·row + c, y = d·col + e·row + f. */
  transform: readonly [number, number, number, number, number, number];
  nodata: number | null;
  epsg: number | null;
  readWindow(
    col0: number,
    row0: number,
    cols: number,
    rows: number,
  ): Promise<Float32Array | Float64Array | Uint8Array>;
}

export async function openCog(url: string): Promise<CogDataset> {
  const tiff = await fromUrl(url, { headers: { "user-agent": USER_AGENT } });
  const image = await tiff.getImage(0);
  let [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution(); // already negative for north-up
  const geoKeys = image.getGeoKeys() as {
    ProjectedCSTypeGeoKey?: number;
    GeographicTypeGeoKey?: number;
    GTRasterTypeGeoKey?: number;
  } | null;
  // A PixelIsPoint raster anchors its tiepoint on the pixel centre; shift half
  // a pixel so the transform maps pixel corners, as GDAL does.
  if (geoKeys?.GTRasterTypeGeoKey === 2) {
    // GDAL's rotation terms, zero here.
    // eslint-disable-next-line oxc/erasing-op
    originX -= resX * 0.5 + 0 * 0.5;
    // eslint-disable-next-line oxc/erasing-op
    originY -= 0 * 0.5 + resY * 0.5;
  }
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    transform: [resX, 0, originX, 0, resY, originY],
    nodata: image.getGDALNoData(),
    epsg: geoKeys?.ProjectedCSTypeGeoKey ?? geoKeys?.GeographicTypeGeoKey ?? null,
    async readWindow(col0, row0, cols, rows) {
      const rasters = await image.readRasters({ window: [col0, row0, col0 + cols, row0 + rows] });
      return rasters[0] as Float32Array | Float64Array | Uint8Array;
    },
  };
}

export function datasetIndex(
  transform: readonly [number, number, number, number, number, number],
  x: number,
  y: number,
): [number, number] {
  const [a, b, c, d, e, f] = transform;
  const det = a * e - b * d;
  const idet = 1.0 / det;
  const ra = e * idet;
  const rb = -b * idet;
  const rd = -d * idet;
  const re = a * idet;
  const col = ra * x + rb * y + (-(c * ra) - f * rb);
  const row = rd * x + re * y + (-(c * rd) - f * re);
  return [Math.floor(row), Math.floor(col)];
}

function maskFor(
  values: Float32Array | Float64Array | Uint8Array,
  nodata: number | null,
): Uint8Array | null {
  if (nodata === null) {
    return null;
  }
  const mask = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(nodata) ? Number.isNaN(values[i]) : values[i] === nodata) {
      mask[i] = 1;
    }
  }
  return mask;
}

export async function cogWindow(
  dataset: CogDataset,
  latitude: number,
  longitude: number,
  halfM: number,
): Promise<{ window: RasterWindow; lats: Float64Array; lons: Float64Array }> {
  const dlat = halfM / M_PER_DEG_LAT;
  const dlon = halfM / mPerDegLon(latitude);
  let [row0, col0] = datasetIndex(dataset.transform, longitude - dlon, latitude + dlat);
  let [row1, col1] = datasetIndex(dataset.transform, longitude + dlon, latitude - dlat);
  row0 = Math.max(0, row0);
  col0 = Math.max(0, col0);
  row1 = Math.min(dataset.height - 1, row1);
  col1 = Math.min(dataset.width - 1, col1);
  const rows = row1 - row0 + 1;
  const cols = col1 - col0 + 1;
  const values = await dataset.readWindow(col0, row0, cols, rows);
  const [a, , c, , e, f] = dataset.transform;
  const cWindow = a * col0 + c;
  const fWindow = e * row0 + f;
  const lons = new Float64Array(cols);
  for (let j = 0; j < cols; j++) {
    lons[j] = cWindow + (j + 0.5) * a;
  }
  const lats = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    lats[i] = fWindow + (i + 0.5) * e;
  }
  return { window: { values, mask: maskFor(values, dataset.nodata), rows, cols }, lats, lons };
}

export function projectedPointFromWindow(
  window: RasterWindow,
  windowTransform: { a: number; c: number; e: number; f: number },
  x: number,
  y: number,
): number | null {
  const { a, c, e, f } = windowTransform;
  const fx = (x - (c + 0.5 * a)) / a;
  const fy = (y - (f + 0.5 * e)) / e;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (y0 < 0 || x0 < 0 || y0 + 1 >= window.rows || x0 + 1 >= window.cols) {
    return null;
  }
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      if (isMasked(window, y0 + dy, x0 + dx)) {
        return null;
      }
    }
  }
  const q00 = window.values[y0 * window.cols + x0];
  const q01 = window.values[y0 * window.cols + x0 + 1];
  const q10 = window.values[(y0 + 1) * window.cols + x0];
  const q11 = window.values[(y0 + 1) * window.cols + x0 + 1];
  const tx = fx - x0;
  const ty = fy - y0;
  return q00 * (1 - tx) * (1 - ty) + q01 * tx * (1 - ty) + q10 * (1 - tx) * ty + q11 * tx * ty;
}

export async function projectedPoint(
  dataset: CogDataset,
  latitude: number,
  longitude: number,
): Promise<number | null> {
  if (dataset.epsg === null) {
    throw new Error("projected DTM declares no EPSG code — cannot reproject into it");
  }
  const [x, y] = projectPoint(dataset.epsg, latitude, longitude);
  const [row, col] = datasetIndex(dataset.transform, x, y);
  if (!(row >= 2 && row < dataset.height - 2 && col >= 2 && col < dataset.width - 2)) {
    return null;
  }
  const values = await dataset.readWindow(col - 2, row - 2, 5, 5);
  const [a, , c, , e, f] = dataset.transform;
  return projectedPointFromWindow(
    { values, mask: maskFor(values, dataset.nodata), rows: 5, cols: 5 },
    { a, c: a * (col - 2) + c, e, f: e * (row - 2) + f },
    x,
    y,
  );
}

export async function lidarbcUrls(
  latitude: number,
  longitude: number,
  fetchImpl: TransportFetch = globalThis.fetch,
): Promise<string[]> {
  const params = new URLSearchParams({
    geometry: `${longitude},${latitude}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "year,s3Url",
    returnGeometry: "false",
    f: "json",
  });
  const response = await fetchImpl(`${LIDARBC_QUERY_URL}?${params}`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
  });
  if (response.status !== 200) {
    throw new Error(`LidarBC tile index query returned HTTP ${response.status}`);
  }
  const payload = JSON.parse(
    new TextDecoder().decode(await response.arrayBuffer()),
  ) as LidarbcPayload;
  // ArcGIS reports failures as HTTP 200 with an error body.
  if (payload.error !== undefined) {
    throw new Error(`LidarBC tile index query failed: ${JSON.stringify(payload.error)}`);
  }
  return lidarbcCandidates(payload);
}

export interface GenerateOptions {
  fetch?: TransportFetch;
  generatedAt?: string;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

export async function generate(
  sites: readonly SitePoint[],
  outputPath: string,
  {
    fetch = globalThis.fetch,
    generatedAt,
    log = console.log,
    warn = console.error,
  }: GenerateOptions = {},
): Promise<number> {
  const stamp = generatedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const opened = new Map<string, Promise<CogDataset>>();
  const dataset = (url: string): Promise<CogDataset> => {
    let handle = opened.get(url);
    if (handle === undefined) {
      handle = openCog(url);
      opened.set(url, handle);
    }
    return handle;
  };

  const terrainOf = async (site: SitePoint): Promise<TerrainBlock> => {
    const url = glo30Url(site.latitude, site.longitude);
    const { window, lats, lons } = await cogWindow(
      await dataset(url),
      site.latitude,
      site.longitude,
      Math.max(...RELIEF_RADII_M) + 200,
    );
    return terrainFromWindow(window, lats, lons, site);
  };

  const elevationOf = async (site: SitePoint): Promise<ElevationPick | null> =>
    pickElevation(
      async (url) => projectedPoint(await dataset(url), site.latitude, site.longitude),
      await lidarbcUrls(site.latitude, site.longitude, fetch),
    );

  const landCoverOf = async (site: SitePoint): Promise<LandCoverBlock> => {
    const url = worldcoverUrl(site.latitude, site.longitude);
    const { window, lats, lons } = await cogWindow(
      await dataset(url),
      site.latitude,
      site.longitude,
      Math.max(...LAND_COVER_RADII_M) + 100,
    );
    return landCoverFromWindow(window, lats, lons, site);
  };

  const document = await buildDocument(sites, {
    terrainOf,
    elevationOf,
    landCoverOf,
    generatedAt: stamp,
    log,
    warn,
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeJson(outputPath, roundDocument(document), { compact: false });
  log(`Wrote terrain context for ${sites.length} site(s) to ${outputPath}.`);
  return 0;
}
