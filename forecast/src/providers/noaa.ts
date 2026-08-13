import {
  ECCODES_MISSING_VALUE,
  decodeFieldValues,
  fetchIndex as gribFetchIndex,
  fetchRecord as gribFetchRecord,
  gridKey,
  nearestGridpoint,
  parseFields,
  parseGrid,
  parseProduct,
  type GribField,
  type IdxFetch,
  type IdxRecord,
  type NearestGridpoint,
} from "@azohra/meteo.grib";
import {
  REQUEST_TIMEOUT_S,
  USER_AGENT,
  type DownloadCounters,
  type TransportFetch,
} from "./transport.js";

export interface NoaaOptions {
  stats?: DownloadCounters;
  fetch?: TransportFetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

function retryingFetch(options: NoaaOptions): IdxFetch {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  return async (url, init) => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      options.stats?.recordRequest(attempt > 0);
      try {
        const response = await fetchImpl(url, {
          headers: { "user-agent": USER_AGENT, ...init?.headers },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`NOAA ${url} failed with ${response.status}`);
        } else {
          const body = new Uint8Array(await response.arrayBuffer());
          if (response.status === 200 || response.status === 206) {
            options.stats?.recordBytes(body.byteLength);
          }
          return {
            status: response.status,
            text: async () => new TextDecoder().decode(body),
            arrayBuffer: async () => body.slice().buffer as ArrayBuffer,
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (attempt < 2) {
        await sleep(0.25 * 2 ** attempt * (0.75 + random() * 0.5) * 1000);
      }
    }
    throw lastError!;
  };
}

export async function fetchIndex(url: string, options: NoaaOptions = {}): Promise<IdxRecord[]> {
  return gribFetchIndex(retryingFetch(options), url);
}

export async function fetchRecord(
  url: string,
  record: IdxRecord,
  options: NoaaOptions = {},
): Promise<Uint8Array> {
  return gribFetchRecord(retryingFetch(options), url, record);
}

export interface GridPointValue {
  value: number | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
}

export interface SampleSite {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
}

export type NearestLookup = typeof nearestGridpoint;

export interface SampleOptions {
  nearest?: NearestLookup;
}

const gridPointsCache = new Map<string, Map<string, NearestGridpoint>>();

export function resetGridPointsCache(): void {
  gridPointsCache.clear();
}

function gridPoints(
  field: GribField,
  sites: readonly SampleSite[],
  maxDistanceKm: number,
  nearest: NearestLookup,
): Map<string, NearestGridpoint> {
  const key = [
    gridKey(field.section3),
    maxDistanceKm,
    ...sites.map((site) => `${site.slug},${site.latitude},${site.longitude}`),
  ].join("|");
  const cached = gridPointsCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const grid = parseGrid(field.section3);
  const points = new Map<string, NearestGridpoint>();
  for (const site of sites) {
    const point = nearest(grid, site.latitude, site.longitude);
    if (point.distanceKm > maxDistanceKm) {
      throw new Error(
        `${site.name} is outside the model grid ` +
          `(nearest gridpoint ${point.distanceKm.toFixed(0)} km away)`,
      );
    }
    points.set(site.slug, point);
  }
  gridPointsCache.set(key, points);
  return points;
}

export function sampleSites(
  message: Uint8Array,
  sites: readonly SampleSite[],
  maxDistanceKm: number,
  options: SampleOptions = {},
): Record<string, GridPointValue> {
  const [field] = parseFields(message);
  if (field === undefined) {
    throw new Error("NOAA message contains no decodable field");
  }
  return sampleField(field, sites, maxDistanceKm, options.nearest ?? nearestGridpoint);
}

// GRIB2 code table 4.2, discipline 0 category 2.
const UGRD_PARAMETER_NUMBER = 2;
const VGRD_PARAMETER_NUMBER = 3;

export function sampleSitesUv(
  message: Uint8Array,
  sites: readonly SampleSite[],
  maxDistanceKm: number,
  options: SampleOptions = {},
): [Record<string, GridPointValue>, Record<string, GridPointValue>] {
  const nearest = options.nearest ?? nearestGridpoint;
  const byComponent = new Map<number, Record<string, GridPointValue>>();
  for (const field of parseFields(message)) {
    const component = parseProduct(field.section4).parameterNumber;
    byComponent.set(component, sampleField(field, sites, maxDistanceKm, nearest));
  }
  const u = byComponent.get(UGRD_PARAMETER_NUMBER);
  const v = byComponent.get(VGRD_PARAMETER_NUMBER);
  if (u === undefined || v === undefined) {
    throw new Error("NOAA paired-wind message is missing a U or V component");
  }
  return [u, v];
}

function sampleField(
  field: GribField,
  sites: readonly SampleSite[],
  maxDistanceKm: number,
  nearest: NearestLookup,
): Record<string, GridPointValue> {
  const points = gridPoints(field, sites, maxDistanceKm, nearest);
  const decoded = decodeFieldValues(field, { missingValue: ECCODES_MISSING_VALUE });
  const samples: Record<string, GridPointValue> = {};
  for (const site of sites) {
    const point = points.get(site.slug)!;
    const masked = decoded.missingMask !== undefined && decoded.missingMask[point.index] === 1;
    samples[site.slug] = {
      value: masked ? null : decoded.values[point.index]!,
      latitude: point.latitude,
      longitude: point.longitude,
      distanceKm: point.distanceKm,
    };
  }
  return samples;
}

export function windFromUv(uMs: number, vMs: number): [speedMps: number, directionDeg: number] {
  const speed = Math.hypot(uMs, vMs);
  // Multiply by 180/π; dividing by the inverse constant can differ in the last ulp.
  const direction = (((Math.atan2(-uMs, -vMs) * (180 / Math.PI)) % 360) + 360) % 360;
  return [speed, direction];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
