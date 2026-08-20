import {
  ECCODES_MISSING_VALUE,
  gridKey,
  nearestGridpoint,
  parseFields,
  parseGrid,
  sampleFieldValuesAsync,
  type DecodeJ2kAsync,
  type DecodeJ2kSampled,
  type NearestGridpoint,
  type SampledFieldValues,
} from "@azohra/meteo.grib";
import {
  createNodeJ2kDecoderPool,
  type J2kDecoderPool,
  type J2kDecoderPoolOptions,
} from "@azohra/meteo.grib/j2k-node";
import {
  REQUEST_TIMEOUT_S,
  USER_AGENT,
  keepAliveFetch,
  transportBackoff,
  type DownloadCounters,
  type TransportFetch,
  type TransportResponse,
} from "./transport.js";

export const DD_URL = "https://dd.weather.gc.ca";

export function datamartBase(): string {
  return (process.env["METEO_DATAMART_BASE"] ?? DD_URL).replace(/\/+$/, "");
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface FetchBytesOptions {
  stats?: DownloadCounters;
  fetch?: TransportFetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export async function fetchBytes(
  url: string,
  options: FetchBytesOptions = {},
): Promise<Uint8Array> {
  // Keep-alive is required: undici's default fetch reconnects per request
  // because the Datamart answers with `Connection: Upgrade`.
  const fetchImpl = options.fetch ?? keepAliveFetch;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    options.stats?.recordRequest(attempt > 0);
    const settle = options.stats?.timeRequest(url);
    let response: TransportResponse | null = null;
    let body: Uint8Array | null = null;
    try {
      response = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
      });
      if (response.status === 200) {
        body = new Uint8Array(await response.arrayBuffer());
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      response = null;
    }
    if (response !== null) {
      if (response.status === 200) {
        const mismatch = contentLengthMismatch(response, body!);
        if (mismatch === null) {
          settle?.(body!.byteLength, true);
          options.stats?.recordBytes(body!.byteLength);
          return body!;
        }
        settle?.(0, false);
        lastError = new Error(`Datamart ${url} ${mismatch}`);
      } else if (response.status === 404) {
        settle?.(0, true);
        throw new NotFoundError(`Datamart ${url} returned 404`);
      } else if (response.status !== 429 && response.status < 500) {
        settle?.(0, false);
        throw new Error(`Datamart ${url} failed with ${response.status}`);
      } else {
        settle?.(0, false);
        lastError = new Error(`Datamart ${url} failed with ${response.status}`);
      }
    } else {
      settle?.(0, false);
    }
    if (attempt < 2) {
      await transportBackoff(attempt, options);
    }
  }
  throw lastError!;
}

function contentLengthMismatch(response: TransportResponse, body: Uint8Array): string | null {
  const declared = response.headers.get("content-length");
  if (declared === null || response.headers.get("content-encoding")) {
    return null;
  }
  if (body.byteLength === Number(declared)) {
    return null;
  }
  return `returned ${body.byteLength} bytes against Content-Length ${declared}`;
}

export const FETCH_CONCURRENCY = 5;
const J2K_POOL_DEFAULT_MAX_WORKERS = 8;
export const TASK_CONCURRENCY = FETCH_CONCURRENCY + J2K_POOL_DEFAULT_MAX_WORKERS;

// close() is mandatory once a decode may have run: pool workers are real
// threads and hold the process open.
export interface LazyJ2kPool {
  decode: DecodeJ2kAsync;
  decodeSampled: DecodeJ2kSampled;
  close(): Promise<void>;
}

export function lazyJ2kPool(options: J2kDecoderPoolOptions = {}): LazyJ2kPool {
  let poolPromise: Promise<J2kDecoderPool> | undefined;
  const pool = (): Promise<J2kDecoderPool> => (poolPromise ??= createNodeJ2kDecoderPool(options));
  return {
    decode: async (codestream) => (await pool()).decode(codestream),
    decodeSampled: async (codestream, scaling, indices) =>
      (await pool()).decodeSampled(codestream, scaling, indices),
    close: async () => {
      const pending = poolPromise;
      poolPromise = undefined;
      const booted = await pending?.catch(() => undefined);
      await booted?.close();
    },
  };
}

export interface DatamartSite {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  timeZone?: string;
}

const gridPointsCache = new Map<string, Map<string, NearestGridpoint>>();

export function resetGridPointsCache(): void {
  gridPointsCache.clear();
}

const sampledByMessage = new WeakMap<
  Uint8Array,
  { key: string; pending: Promise<SampledFieldValues> }
>();

export async function sampleDatamartField(
  message: Uint8Array,
  sites: readonly DatamartSite[],
  maxDistanceKm: number | undefined,
  decodeJ2k?: DecodeJ2kAsync,
  decodeJ2kSampled?: DecodeJ2kSampled,
): Promise<Record<string, number | null>> {
  const [field] = parseFields(message);
  if (field === undefined) {
    throw new Error("Datamart message contains no decodable field");
  }
  const key = [
    gridKey(field.section3),
    ...sites.map((site) => `${site.slug},${site.latitude},${site.longitude}`),
  ].join("|");
  let points = gridPointsCache.get(key);
  if (points === undefined) {
    const grid = parseGrid(field.section3);
    points = new Map();
    for (const site of sites) {
      points.set(site.slug, nearestGridpoint(grid, site.latitude, site.longitude));
    }
    gridPointsCache.set(key, points);
  }
  for (const site of sites) {
    const point = points.get(site.slug)!;
    if (maxDistanceKm !== undefined && point.distanceKm > maxDistanceKm) {
      throw new Error(
        `(${site.latitude}, ${site.longitude}) is outside the model grid ` +
          `(nearest gridpoint ${point.distanceKm.toFixed(0)} km away)`,
      );
    }
  }
  let cached = sampledByMessage.get(message);
  if (cached === undefined || cached.key !== key) {
    const indices = Uint32Array.from(sites, (site) => points.get(site.slug)!.index);
    cached = {
      key,
      pending: sampleFieldValuesAsync(field, indices, {
        ...(decodeJ2k !== undefined ? { decodeJ2k } : {}),
        ...(decodeJ2kSampled !== undefined ? { decodeJ2kSampled } : {}),
        missingValue: ECCODES_MISSING_VALUE,
      }),
    };
    sampledByMessage.set(message, cached);
  }
  const sampled = await cached.pending;
  const samples: Record<string, number | null> = {};
  for (let i = 0; i < sites.length; i++) {
    const masked = sampled.missingMask !== undefined && sampled.missingMask[i] === 1;
    samples[sites[i]!.slug] = masked ? null : sampled.values[i]!;
  }
  return samples;
}

export interface DatamartWire {
  fetchBytes(url: string): Promise<Uint8Array>;
  sampleSites(
    message: Uint8Array,
    sites: readonly DatamartSite[],
    maxDistanceKm?: number,
  ): Promise<Record<string, number | null>>;
  close?(): Promise<void>;
}

export interface LiveDatamartWireOptions extends FetchBytesOptions {
  decodeJ2k?: DecodeJ2kAsync;
  poolSize?: number;
}

export function liveDatamartWire(options: LiveDatamartWireOptions = {}): DatamartWire {
  const pool =
    options.decodeJ2k === undefined
      ? lazyJ2kPool(options.poolSize !== undefined ? { size: options.poolSize } : {})
      : undefined;
  const decodeJ2k = options.decodeJ2k ?? pool!.decode;
  const decodeJ2kSampled = pool?.decodeSampled;
  return {
    fetchBytes: (url) => fetchBytes(url, options),
    sampleSites: (message, sites, maxDistanceKm) =>
      sampleDatamartField(message, sites, maxDistanceKm, decodeJ2k, decodeJ2kSampled),
    close: () => pool?.close() ?? Promise.resolve(),
  };
}
