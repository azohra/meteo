import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchPublished as fetchPublishedDataset,
  publishedHistory as publishedHistoryDataset,
  publishedManifest as publishedManifestDataset,
} from "../dataset.js";
import {
  MANIFEST_SCHEMA_VERSION,
  OBSERVATION_SCHEMA_VERSION,
} from "@azohra/meteo.briefing/contract";
import { appendHistoryLines } from "../history.js";
import { manifestStats, roundDocument, writeJson, type PublishedManifest } from "../publish.js";
import { parseSites } from "../sites.js";
import { DownloadCounters, USER_AGENT, type TransportFetch } from "../providers/transport.js";
import { runConcurrent } from "./common.js";
import { openGranule, type GranuleReader } from "./granule.js";

export const BUCKET = "https://noaa-goes18.s3.amazonaws.com";
// The bucket is its own host, so the granule walk gets the same per-bucket
// connection budget as the other NOAA builders.
export const FETCH_CONCURRENCY = 10;
export const WINDOW_HOURS = 72;
export const DEFAULT_BACKFILL_HOURS = 6;
export const GOES_REQUEST_TIMEOUT_S = 120;
const ABI_FIXED_GRID_STEP_RAD = 5.6e-5;
export const MAX_INDEX_OFFSET_RAD = ABI_FIXED_GRID_STEP_RAD * 1.5;

export interface Product {
  slug: string;
  prefix: string;
  variable: string;
  valueKey: string;
  /** The measured quantity the product publishes — the document's and the catalogue entry's `quantity`. */
  quantity: "downwardShortwave" | "aot";
  maxQuality: number;
  label: string;
}

// A nonzero DQF publishes on the entry as `quality`, so display policy
// stays with consumers instead of being baked into collection.
export const PRODUCTS: Record<"goes18-dsr" | "goes18-aod", Product> = {
  // DSR's DQF is binary (0 good, 1 degraded/invalid — beyond the 70°
  // good-quality zenith bound or otherwise refused a grade). maxQuality 1
  // admits the unmasked degraded retrievals — the sunrise and sunset
  // shoulders — labelled `quality: 1`: indicative, not quantitative.
  "goes18-dsr": {
    slug: "goes18-dsr",
    prefix: "ABI-L2-DSRF",
    variable: "DSR",
    valueKey: "downwardShortwaveWm2",
    quantity: "downwardShortwave",
    maxQuality: 1,
    label: "GOES-18 DSR",
  },
  // maxQuality 1 admits high + medium quality (Zhang, Kondragunta et al. 2020).
  "goes18-aod": {
    slug: "goes18-aod",
    prefix: "ABI-L2-AODF",
    variable: "AOD",
    valueKey: "aot",
    quantity: "aot",
    maxQuality: 1,
    label: "GOES-18 AOD",
  },
};

const KEY_STAMP = /_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})\d_/;

export interface GoesSite {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  timeZone?: string;
}

export interface ObservationEntry {
  observedAt: string;
  [key: string]: unknown;
}

export type SiteIndices = Record<string, readonly [number, number]>;

export interface GoesWire {
  fetch: TransportFetch;
  sleep: (ms: number) => Promise<void>;
}

export interface GranuleSample {
  value: number;
  /** The pixel's DQF as sampled; 0 is the product's best grade. */
  quality: number;
}

export type GranuleSampler = (
  url: string,
  product: Product,
  sites: readonly GoesSite[],
  indices: SiteIndices | null,
  stats: DownloadCounters,
  wire: GoesWire,
) => Promise<{ indices: SiteIndices | null; samples: Record<string, GranuleSample> }>;

export type GoesSiteSource = { sites: readonly GoesSite[] } | { sitesPath: string };

export type GoesBuildOptions = GoesSiteSource & {
  fetch?: TransportFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  history?: boolean;
  outputRoot?: string;
  publishedManifest?: (slug: string) => Promise<PublishedManifest | null>;
  fetchPublished?: (path: string) => Promise<Uint8Array | null>;
  publishedHistory?: (model: string, siteId: string, month: string) => Promise<Uint8Array>;
  granuleSamples?: GranuleSampler;
  log?: (line: string) => void;
};

export function observationManifest(
  slug: string,
  sites: readonly GoesSite[],
  firstObservedAt: string,
  lastObservedAt: string,
  observationCount: number,
  stats: Record<string, number>,
): Record<string, unknown> {
  return {
    firstObservedAt,
    generatedAt: instantMilliseconds(),
    lastObservedAt,
    model: slug,
    observationCount,
    referenceTime: lastObservedAt,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sites: sites.map((site) => ({ name: site.name, slug: site.slug })),
    stats,
  };
}

export async function buildGoesProduct(product: Product, options: GoesBuildOptions): Promise<void> {
  const log = options.log ?? console.log;
  const sites =
    "sites" in options
      ? options.sites
      : parseSites(readFileSync(options.sitesPath, "utf-8"), options.sitesPath);
  const wire: GoesWire = {
    fetch: options.fetch ?? globalThis.fetch,
    sleep: options.sleep ?? defaultSleep,
  };
  const now = (options.now ?? (() => new Date()))();
  const backfillHours = backfillHoursFromEnv();
  const readManifest = options.publishedManifest ?? ((slug) => publishedManifestDataset(slug));
  const manifest = await readManifest(product.slug);
  const backfillFloor = new Date(now.getTime() - backfillHours * 3_600_000);
  let lastObserved =
    manifest !== null && manifest !== undefined
      ? instantToDate(manifest["lastObservedAt"] as string)
      : backfillFloor;
  if (lastObserved.getTime() < backfillFloor.getTime()) {
    lastObserved = backfillFloor;
  }

  const stats = new DownloadCounters();
  let keys = await scanKeysSince(product, lastObserved, now, stats, wire);
  const maxSteps = maxStepsFromEnv();
  if (maxSteps !== null) {
    keys = keys.slice(0, maxSteps);
  }
  if (keys.length === 0) {
    log(`No ${product.label} granules newer than ${dateToInstant(lastObserved)}.`);
    return;
  }

  log(`Sampling ${keys.length} ${product.label} granules for ${sites.length} sites…`);
  const startedAt = performance.now();
  const sampler = options.granuleSamples ?? sampleGranule;
  const newObservations = new Map<string, ObservationEntry[]>(sites.map((site) => [site.slug, []]));
  // The first granule locates every site's grid indices; the rest reuse
  // them and fetch concurrently. Samples land keyed by position so the
  // observation entries stay in granule order regardless of completion.
  let indices: SiteIndices | null = null;
  const samplesByKey = Array.from<Record<string, GranuleSample>>({ length: keys.length });
  const sampleAt = async (index: number): Promise<void> => {
    const [key] = keys[index]!;
    const { indices: located, samples } = await sampler(
      `${BUCKET}/${key}`,
      product,
      sites,
      indices,
      stats,
      wire,
    );
    indices ??= located;
    log(`  ${key.split("/").pop()!}: whole-file`);
    samplesByKey[index] = samples;
  };
  await sampleAt(0);
  await runConcurrent(
    keys.slice(1).map((_, offset) => () => sampleAt(offset + 1)),
    FETCH_CONCURRENCY,
  );
  for (const [index, [, observedAt]] of keys.entries()) {
    for (const [siteSlug, sample] of Object.entries(samplesByKey[index] ?? {})) {
      newObservations.get(siteSlug)?.push({
        observedAt,
        [product.valueKey]: sample.value,
        // The best grade publishes bare; a nonzero DQF travels with the value.
        ...(sample.quality > 0 ? { quality: sample.quality } : {}),
      });
    }
  }

  let totalNew = 0;
  for (const entries of newObservations.values()) {
    totalNew += entries.length;
  }
  if (totalNew === 0) {
    log(`No valid ${product.label} retrievals in ${keys.length} granules (night or flagged).`);
    return;
  }

  const fetchPublishedBytes = options.fetchPublished ?? ((path) => fetchPublishedDataset(path));
  const publishedHistory =
    options.publishedHistory ??
    ((model, siteId, month) => publishedHistoryDataset(model, siteId, month));
  const generatedAt = dateToInstant((options.now ?? (() => new Date()))());
  const outDir = join(options.outputRoot ?? "data", product.slug);
  const sitesDir = join(outDir, "sites");
  mkdirSync(sitesDir, { recursive: true });
  const historyDir = join(outDir, "history");
  let firstObservedAt: string | null = null;
  let lastObservedAt: string | null = null;
  let observationCount = 0;
  for (const site of sites) {
    const { window, newlyAdded } = await mergedWindow(
      product,
      site.slug,
      newObservations.get(site.slug) ?? [],
      fetchPublishedBytes,
    );
    if (window.length === 0) {
      continue;
    }
    if (options.history ?? true) {
      await appendGoesHistory(product, site.slug, newlyAdded, historyDir, publishedHistory);
    }
    const document = siteDocument(product, site, window, generatedAt);
    writeJson(join(sitesDir, `${site.slug}.json`), document, { compact: true });
    observationCount += window.length;
    if (firstObservedAt === null || window[0].observedAt < firstObservedAt) {
      firstObservedAt = window[0].observedAt;
    }
    if (lastObservedAt === null || window[window.length - 1].observedAt > lastObservedAt) {
      lastObservedAt = window[window.length - 1].observedAt;
    }
  }

  const manifestDocument = observationManifest(
    product.slug,
    sites,
    firstObservedAt!,
    lastObservedAt!,
    observationCount,
    manifestStats(stats, startedAt),
  );
  writeJson(join(outDir, "manifest.json"), manifestDocument, { compact: false });
  log(
    `Published ${totalNew} new ${product.label} observations ` +
      `(window now ${firstObservedAt} … ${lastObservedAt}, ` +
      `${stats.requests} requests, ${Math.floor(stats.responseBytes / (1024 * 1024))} MiB).`,
  );
  for (const line of stats.transportReport()) {
    log(line);
  }
}

export async function scanKeysSince(
  product: Product,
  lastObserved: Date,
  now: Date,
  stats: DownloadCounters,
  wire: GoesWire,
): Promise<Array<[key: string, observedAt: string]>> {
  const keys: Array<[string, string]> = [];
  let cursor = new Date(lastObserved);
  cursor.setUTCMinutes(0, 0, 0);
  while (cursor.getTime() <= now.getTime()) {
    const prefix =
      `${product.prefix}/${cursor.getUTCFullYear()}/` +
      `${String(dayOfYear(cursor)).padStart(3, "0")}/` +
      `${String(cursor.getUTCHours()).padStart(2, "0")}/`;
    const payload = await fetchGoes(`${BUCKET}/?list-type=2&prefix=${prefix}`, stats, wire);
    for (const key of listedKeys(new TextDecoder().decode(payload))) {
      const observed = scanKeyDate(key);
      if (observed !== null && observed.getTime() > lastObserved.getTime()) {
        keys.push([key, dateToInstant(observed)]);
      }
    }
    cursor = new Date(cursor.getTime() + 3_600_000);
  }
  keys.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return keys;
}

export function listedKeys(xml: string): string[] {
  const keys: string[] = [];
  let cursor = 0;
  for (;;) {
    const open = xml.indexOf("<Contents>", cursor);
    if (open === -1) {
      break;
    }
    const close = xml.indexOf("</Contents>", open);
    if (close === -1) {
      throw new Error("unterminated <Contents> element in the S3 listing");
    }
    const block = xml.slice(open + "<Contents>".length, close);
    const keyOpen = block.indexOf("<Key>");
    const keyClose = block.indexOf("</Key>");
    if (keyOpen !== -1 && keyClose > keyOpen) {
      const key = decodeXmlText(block.slice(keyOpen + "<Key>".length, keyClose));
      if (key.endsWith(".nc")) {
        keys.push(key);
      }
    }
    cursor = close + "</Contents>".length;
  }
  return keys;
}

export function scanKeyInstant(key: string): string | null {
  const observed = scanKeyDate(key);
  return observed === null ? null : dateToInstant(observed);
}

function scanKeyDate(key: string): Date | null {
  const stamp = KEY_STAMP.exec(key);
  if (stamp === null) {
    return null;
  }
  const [year, dayOfYearStamp, hour, minute, second] = stamp
    .slice(1)
    .map((group) => Number.parseInt(group, 10));
  return new Date(Date.UTC(year, 0, 1, hour, minute, second) + (dayOfYearStamp - 1) * 86_400_000);
}

export const sampleGranule: GranuleSampler = async (url, product, sites, indices, stats, wire) => {
  const payload = await fetchGoes(url, stats, wire);
  const granule = await openGranule(payload);
  try {
    return sampleSites(granule, product, sites, indices);
  } finally {
    granule.close();
  }
};

export function sampleSites(
  granule: GranuleReader,
  product: Product,
  sites: readonly GoesSite[],
  indices: SiteIndices | null,
): { indices: SiteIndices; samples: Record<string, GranuleSample> } {
  const located =
    indices ?? Object.fromEntries(sites.map((site) => [site.slug, siteIndex(granule, site)]));
  const values = granule.variable(product.variable);
  const dqf = granule.variable("DQF");
  const samples: Record<string, GranuleSample> = {};
  for (const site of sites) {
    const [yIndex, xIndex] = located[site.slug];
    const value = values.pixel(yIndex, xIndex);
    if (value === null) {
      continue;
    }
    const quality = dqf.pixel(yIndex, xIndex);
    if (quality === null || quality > product.maxQuality) {
      continue;
    }
    samples[site.slug] = { value, quality };
  }
  return { indices: located, samples };
}

// GOES-R PUG Volume 3 forward equations, geodetic → scan angles.
export function siteIndex(
  granule: GranuleReader,
  site: Pick<GoesSite, "name" | "latitude" | "longitude">,
): readonly [number, number] {
  const projection = granule.variable("goes_imager_projection");
  const req = projection.attribute("semi_major_axis");
  const rpol = projection.attribute("semi_minor_axis");
  const satelliteRadius = projection.attribute("perspective_point_height") + req;
  const lon0 = (projection.attribute("longitude_of_projection_origin") * Math.PI) / 180;

  const lat = (site.latitude * Math.PI) / 180;
  const lon = (site.longitude * Math.PI) / 180;
  const geocentricLat = Math.atan(((rpol * rpol) / (req * req)) * Math.tan(lat));
  const rc =
    rpol / Math.sqrt(1 - ((req * req - rpol * rpol) / (req * req)) * Math.cos(geocentricLat) ** 2);
  const sx = satelliteRadius - rc * Math.cos(geocentricLat) * Math.cos(lon - lon0);
  const sy = -rc * Math.cos(geocentricLat) * Math.sin(lon - lon0);
  const sz = rc * Math.sin(geocentricLat);
  if (
    satelliteRadius * (satelliteRadius - sx) <
    sy * sy + ((req * req) / (rpol * rpol)) * sz * sz
  ) {
    throw new Error(`${site.name} is outside the GOES-18 full-disk grid`);
  }
  const x = Math.asin(-sy / Math.sqrt(sx * sx + sy * sy + sz * sz));
  const y = Math.atan(sz / sx);

  const xValues = granule.variable("x").values();
  const yValues = granule.variable("y").values();
  const xIndex = nearestIndex(xValues, x);
  const yIndex = nearestIndex(yValues, y);
  if (
    Math.abs(xValues[xIndex] - x) > MAX_INDEX_OFFSET_RAD ||
    Math.abs(yValues[yIndex] - y) > MAX_INDEX_OFFSET_RAD
  ) {
    throw new Error(`${site.name} is outside the GOES-18 full-disk grid`);
  }
  return [yIndex, xIndex];
}

function nearestIndex(values: Float64Array, target: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const distance = Math.abs(values[index] - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

export async function mergedWindow(
  product: Product,
  siteSlug: string,
  newEntries: readonly ObservationEntry[],
  fetchPublishedBytes: (path: string) => Promise<Uint8Array | null>,
): Promise<{ window: ObservationEntry[]; newlyAdded: ObservationEntry[] }> {
  const merged = new Map<string, ObservationEntry>();
  const payload = await fetchPublishedBytes(`${product.slug}/sites/${siteSlug}.json`);
  if (payload !== null) {
    const published = JSON.parse(new TextDecoder().decode(payload)) as {
      observations?: ObservationEntry[];
    };
    for (const entry of published.observations ?? []) {
      merged.set(entry.observedAt, entry);
    }
  }
  const publishedInstants = new Set(merged.keys());
  const newlyAdded = new Map<string, ObservationEntry>();
  for (const entry of newEntries) {
    merged.set(entry.observedAt, entry);
    if (!publishedInstants.has(entry.observedAt)) {
      newlyAdded.set(entry.observedAt, entry);
    }
  }
  if (merged.size === 0) {
    return { window: [], newlyAdded: [] };
  }
  const observations = [...merged.values()].sort((a, b) =>
    a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0,
  );
  const horizon =
    instantToDate(observations[observations.length - 1].observedAt).getTime() -
    WINDOW_HOURS * 3_600_000;
  return {
    window: observations.filter((entry) => instantToDate(entry.observedAt).getTime() >= horizon),
    newlyAdded: [...newlyAdded.values()].sort((a, b) =>
      a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0,
    ),
  };
}

export function siteDocument(
  product: Product,
  site: GoesSite,
  observations: readonly ObservationEntry[],
  generatedAt: string,
): unknown {
  return roundDocument({
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    model: product.slug,
    quantity: product.quantity,
    observed: {
      firstObservedAt: observations[0].observedAt,
      lastObservedAt: observations[observations.length - 1].observedAt,
      generatedAt,
    },
    site: {
      id: site.slug,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      ...(site.timeZone ? { timeZone: site.timeZone } : {}),
    },
    observations,
  });
}

export async function appendGoesHistory(
  product: Product,
  siteSlug: string,
  newlyAdded: readonly ObservationEntry[],
  historyDir: string,
  publishedHistory: (model: string, siteId: string, month: string) => Promise<Uint8Array>,
): Promise<void> {
  const byMonth = new Map<string, unknown[]>();
  for (const entry of newlyAdded) {
    const month = entry.observedAt.slice(0, 7);
    const lines = byMonth.get(month) ?? [];
    lines.push(roundDocument(entry));
    byMonth.set(month, lines);
  }
  for (const month of [...byMonth.keys()].sort()) {
    const published = await publishedHistory(product.slug, siteSlug, month);
    appendHistoryLines(
      product.slug,
      siteSlug,
      month,
      byMonth.get(month)!,
      historyDir,
      () => published,
    );
  }
}

async function fetchGoes(
  url: string,
  stats: DownloadCounters,
  wire: GoesWire,
): Promise<Uint8Array> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    stats.recordRequest(attempt > 0);
    const settle = stats.timeRequest(url);
    let status: number | null = null;
    let payload: Uint8Array | null = null;
    try {
      const response = await wire.fetch(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(GOES_REQUEST_TIMEOUT_S * 1000),
      });
      status = response.status;
      if (status === 200) {
        payload = new Uint8Array(await response.arrayBuffer());
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      status = null;
    }
    if (status !== null) {
      if (status === 200) {
        settle(payload!.byteLength, true);
        stats.recordBytes(payload!.byteLength);
        return payload!;
      }
      settle(0, false);
      if (status < 500) {
        throw new Error(`GOES ${url} failed with ${status}`);
      }
      lastError = new Error(`GOES ${url} failed with ${status}`);
    } else {
      settle(0, false);
    }
    if (attempt < 2) {
      await wire.sleep(2 ** attempt * 1000);
    }
  }
  throw new Error(`GOES ${url} failed after retries`, { cause: lastError });
}

function backfillHoursFromEnv(): number {
  const raw = process.env["METEO_GOES_BACKFILL_HOURS"];
  if (raw === undefined || raw === "") {
    return DEFAULT_BACKFILL_HOURS;
  }
  const hours = Number(raw);
  if (!Number.isFinite(hours)) {
    throw new Error(`METEO_GOES_BACKFILL_HOURS is not a number: ${raw}`);
  }
  return hours;
}

function maxStepsFromEnv(): number | null {
  const raw = process.env["METEO_MAX_STEPS"];
  return raw ? Number.parseInt(raw, 10) : null;
}

function decodeXmlText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (entity, name: string) => {
    switch (name) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return String.fromCodePoint(
          name.startsWith("#x")
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10),
        );
    }
  });
}

function dayOfYear(date: Date): number {
  return Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
}

function instantToDate(instant: string): Date {
  return new Date(instant);
}

function dateToInstant(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function instantMilliseconds(): string {
  return new Date().toISOString();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
