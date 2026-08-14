import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publishedHistory, publishedReferenceTime, type DatasetOptions } from "../dataset.js";
import { datamartBase } from "../providers/datamart.js";
import { SCHEMA_VERSION } from "../derive.js";
import { appendHistory, type ArchivableProfile } from "../history.js";
import { manifestStats, roundDocument, writeJson } from "../publish.js";
import { parseSites, type Site } from "../sites.js";
import {
  DownloadCounters,
  exists,
  keepAliveFetch,
  type TransportFetch,
} from "../providers/transport.js";
import {
  manifestInstant,
  maxSteps as envMaxSteps,
  profileInstant,
  runConcurrent,
  validTime,
} from "./common.js";
import { TASK_CONCURRENCY, concurrencyLimit, liveDatamartWire, type DatamartWire } from "./eccc.js";

export const SLUG = "raqdps";
export const PATH = "model_raqdps/10km/grib2";
export const FILE_PREFIX = "MSC_RAQDPS";
export const GRID_TOKEN = "RLatLon0.09";
export const RUN_HOURS = ["12", "00"] as const; // probed newest-first
export const FORECAST_HOURS = 72;
export const FETCH_CONCURRENCY = 5;
export const MAX_NEAREST_KM = 15.0;

export const SMOKE_FIELDS: Record<string, [variable: string, convert: (v: number) => number]> = {
  pm25Ugm3: ["PM2.5_Sfc", (v) => v * 1e9],
  smokePlumeSurfaceUgm3: ["PM2.5-WildfireSmokePlume_Sfc", (v) => v * 1e9],
  smokePlumeColumnMgm2: ["PM2.5-WildfireSmokePlume_EAtm", (v) => v * 1e6],
};

export function fileUrl(
  date: string,
  runHour: string,
  forecastHour: number,
  variable: string,
): string {
  const step = String(forecastHour).padStart(3, "0");
  const name = `${date}T${runHour}Z_${FILE_PREFIX}_${variable}_${GRID_TOKEN}_PT${step}H.grib2`;
  return `${datamartBase()}/${date}/WXO-DD/${PATH}/${runHour}/${step}/${name}`;
}

export interface RaqdpsRun {
  date: string;
  hour: string;
}

export async function latestCompleteRun(
  fetchImpl: TransportFetch = keepAliveFetch,
  now: () => Date = () => new Date(),
): Promise<RaqdpsRun | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of RUN_HOURS) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      const probe = fileUrl(date, hour, FORECAST_HOURS, SMOKE_FIELDS["pm25Ugm3"]![0]);
      if (await exists(probe, fetchImpl)) {
        return { date, hour };
      }
    }
  }
  return null;
}

export interface BuildDocumentsOptions {
  maxSteps?: number;
  wire?: DatamartWire;
  generatedAt?: () => string;
}

export interface SmokeDocument {
  schemaVersion: number;
  model: string;
  run: { referenceTime: string; generatedAt: string };
  site: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    timeZone?: string;
  };
  hours: Array<Record<string, unknown>>;
}

export interface BuildDocumentsResult {
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
  documents: SmokeDocument[];
}

export async function buildDocuments(
  run: RaqdpsRun,
  referenceTime: string,
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildDocumentsOptions = {},
): Promise<BuildDocumentsResult> {
  const wire = options.wire ?? liveDatamartWire({ stats });
  try {
    return await sampleDocuments(run, referenceTime, sites, wire, options);
  } finally {
    if (options.wire === undefined) {
      await wire.close?.();
    }
  }
}

async function sampleDocuments(
  run: RaqdpsRun,
  referenceTime: string,
  sites: readonly Site[],
  wire: DatamartWire,
  options: BuildDocumentsOptions,
): Promise<BuildDocumentsResult> {
  const cap = options.maxSteps ?? envMaxSteps();
  let forecastSlots = Array.from({ length: FORECAST_HOURS }, (_, index) => ({
    forecastHour: index + 1,
    validAt: validTime(referenceTime, index + 1),
  }));
  if (cap !== undefined) {
    forecastSlots = forecastSlots.slice(0, cap);
  }

  const fetchGate = concurrencyLimit(FETCH_CONCURRENCY);
  const sample = async (
    variable: string,
    forecastHour: number,
  ): Promise<Record<string, number | null>> => {
    const url = fileUrl(run.date, run.hour, forecastHour, variable);
    const message = await fetchGate(() => wire.fetchBytes(url));
    return wire.sampleSites(message, sites, MAX_NEAREST_KM);
  };

  const valuesBySite: Record<string, Array<Record<string, number>>> = Object.fromEntries(
    sites.map((site) => [site.slug, forecastSlots.map(() => ({}))]),
  );

  const fieldTask =
    (hourIndex: number, fieldName: string, variable: string, convert: (v: number) => number) =>
    async (): Promise<void> => {
      const values = await sample(variable, forecastSlots[hourIndex]!.forecastHour);
      for (const site of sites) {
        const value = values[site.slug];
        if (value === null || value === undefined || !Number.isFinite(value)) {
          throw new Error(`Datamart returned no ${fieldName} for ${site.name}`);
        }
        valuesBySite[site.slug]![hourIndex]![fieldName] = Math.max(0.0, convert(value));
      }
    };

  await runConcurrent(
    forecastSlots.flatMap((_slot, hourIndex) =>
      Object.entries(SMOKE_FIELDS).map(([fieldName, [variable, convert]]) =>
        fieldTask(hourIndex, fieldName, variable, convert),
      ),
    ),
    TASK_CONCURRENCY,
  );

  const generatedAt = (options.generatedAt ?? profileInstant)();
  const documents: SmokeDocument[] = sites.map((site) => ({
    schemaVersion: SCHEMA_VERSION,
    model: SLUG,
    run: { referenceTime, generatedAt },
    site: {
      id: site.slug,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      ...(site.timeZone ? { timeZone: site.timeZone } : {}),
    },
    hours: forecastSlots.map((slot, hourIndex) => ({
      validAt: slot.validAt,
      ...Object.fromEntries(
        Object.keys(SMOKE_FIELDS).map((fieldName) => [
          fieldName,
          valuesBySite[site.slug]![hourIndex]![fieldName]!,
        ]),
      ),
    })),
  }));
  return {
    firstForecastHour: forecastSlots[0]!.forecastHour,
    forecastHours: forecastSlots.length,
    lastForecastHour: forecastSlots[forecastSlots.length - 1]!.forecastHour,
    documents,
  };
}

export interface RaqdpsBuildOptions {
  sitesPath: string;
  history?: boolean;
  outputRoot?: string;
  maxSteps?: number;
  referenceTime?: string;
  dataset?: DatasetOptions;
  wire?: DatamartWire;
  fetch?: TransportFetch;
  log?: (line: string) => void;
  now?: () => Date;
  generatedAt?: () => string;
}

export async function buildRaqdps(options: RaqdpsBuildOptions): Promise<boolean> {
  const log = options.log ?? ((line: string) => console.log(line));
  const sitesPath = options.sitesPath;
  const outputRoot = options.outputRoot ?? "data";
  const sites = parseSites(readFileSync(sitesPath, "utf-8"), sitesPath);

  let run: RaqdpsRun | null;
  let referenceTime: string;
  if (options.referenceTime !== undefined) {
    run = pinnedRun(options.referenceTime);
    referenceTime = options.referenceTime;
  } else {
    run = await latestCompleteRun(options.fetch, options.now);
    if (run === null) {
      log("No complete RAQDPS run is available.");
      return false;
    }
    const date = run.date;
    referenceTime = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${run.hour}:00:00Z`;
  }
  if ((await publishedReferenceTime(SLUG, options.dataset)) === referenceTime) {
    log(`RAQDPS run ${referenceTime} is already published.`);
    return false;
  }

  log(`Building RAQDPS ${referenceTime} for ${sites.length} sites…`);
  const startedAt = performance.now();
  const stats = new DownloadCounters();
  const buildOptions: BuildDocumentsOptions = {};
  if (options.maxSteps !== undefined) buildOptions.maxSteps = options.maxSteps;
  if (options.wire !== undefined) buildOptions.wire = options.wire;
  if (options.generatedAt !== undefined) buildOptions.generatedAt = options.generatedAt;
  const result = await buildDocuments(run, referenceTime, sites, stats, buildOptions);

  const outDir = join(outputRoot, SLUG);
  const sitesDir = join(outDir, "sites");
  mkdirSync(sitesDir, { recursive: true });
  const month = referenceTime.slice(0, 7);
  for (const document of result.documents) {
    const rounded = roundDocument(document) as ArchivableProfile;
    writeJson(join(sitesDir, `${rounded.site.id}.json`), rounded, { compact: true });
    if (options.history ?? true) {
      const published = await publishedHistory(SLUG, rounded.site.id, month, options.dataset);
      appendHistory(rounded, join(outDir, "history"), () => published);
    }
  }
  const manifest = {
    firstForecastHour: result.firstForecastHour,
    forecastHours: result.forecastHours,
    generatedAt: manifestInstant(),
    lastForecastHour: result.lastForecastHour,
    model: SLUG,
    referenceTime,
    schemaVersion: SCHEMA_VERSION,
    sites: sites.map((site) => ({ name: site.name, slug: site.slug })),
    stats: manifestStats(stats, startedAt),
  };
  writeJson(join(outDir, "manifest.json"), manifest, { compact: false });
  log(
    `Published ${result.documents.length} RAQDPS smoke documents for ${referenceTime} ` +
      `(${stats.requests} downloads, ${Math.floor(stats.responseBytes / (1024 * 1024))} MiB).`,
  );
  for (const line of stats.transportReport()) {
    log(line);
  }
  return true;
}

export function pinnedRun(referenceTime: string): RaqdpsRun {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00Z$/.exec(referenceTime);
  if (match === null) {
    throw new Error(
      `referenceTime ${referenceTime} is not a raqdps cycle stamp (YYYY-MM-DDTHH:00:00Z)`,
    );
  }
  const hour = match[4]!;
  if (!(RUN_HOURS as readonly string[]).includes(hour)) {
    throw new Error(`referenceTime hour ${hour} is not a raqdps cycle (12/00)`);
  }
  return { date: `${match[1]}${match[2]}${match[3]}`, hour };
}
