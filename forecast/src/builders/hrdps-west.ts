import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publishedHistory, publishedReferenceTime, type DatasetOptions } from "../dataset.js";
import { NotFoundError } from "../providers/datamart.js";
import { SCHEMA_VERSION, deriveSiteForecast, type SourceHour } from "../derive.js";
import { appendHistory, type ArchivableProfile } from "../history.js";
import { manifestStats, roundDocument, writeJson } from "../publish.js";
import { maskSentinel } from "../sentinel.js";
import { parseSites, type Site } from "../sites.js";
import {
  DownloadCounters,
  exists,
  keepAliveFetch,
  type TransportFetch,
} from "../providers/transport.js";
import {
  KELVIN,
  emptyHour,
  manifestInstant,
  isCompleteLevel,
  maxSteps as envMaxSteps,
  profileInstant,
  requiredValue,
  runConcurrent,
  validTime,
  type BuilderHour,
} from "./common.js";
import { TASK_CONCURRENCY, concurrencyLimit, liveDatamartWire, type DatamartWire } from "./eccc.js";
import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";

export const SLUG = "hrdps-west";
export const BASE_URL = "https://dd.alpha.weather.gc.ca/model_hrdps/west/1km/grib2";
export const RUN_HOURS = ["12", "00"] as const;
export const FORECAST_HOURS = 48;
export const FETCH_CONCURRENCY = 5;

type Convert = (value: number) => number;

export const SURFACE_FIELDS: Record<string, [variable: string, convert: Convert]> = {
  cloudCoverPercent: ["TCDC_SFC_0", (v) => v],
  dewPointDepressionC: ["DEPR_TGL_2", (v) => v],
  latentHeatFluxWm2: ["LHTFL_SFC_0", (v) => v],
  precipitationMm: ["PRATE_SFC_0", (v) => v * 3600],
  seaLevelPressureHpa: ["PRMSL_MSL_0", (v) => v / 100.0],
  sensibleHeatFluxWm2: ["SHTFL_SFC_0", (v) => v],
  temperatureC: ["TMP_TGL_2", (v) => v - KELVIN],
  windDirectionDeg: ["WDIR_TGL_10", (v) => v],
  windSpeedMps: ["WIND_TGL_10", (v) => v],
};
export const PRESSURE_FIELDS: Record<string, [prefix: string, convert: Convert]> = {
  dewPointDepressionC: ["DEPR", (v) => v],
  heightM: ["HGT", (v) => v],
  temperatureC: ["TMP", (v) => v - KELVIN],
  windDirectionDeg: ["WDIR", (v) => v],
  windSpeedMps: ["WIND", (v) => v],
};
export const PRESSURE_LEVELS = [925, 900, 875, 850, 800, 750, 700, 650, 600] as const;
export const TERRAIN_VARIABLE = "HGT_SFC_0";

// CAPE_ETAL_10000 departs eta = 1.0, i.e. surface-based.
export const GUST_MAX_VARIABLE = "GUST_MAX_TGL_10";
export const GUST_INSTANT_VARIABLE = "GUST_TGL_10";
export const CAPE_VARIABLE = "CAPE_ETAL_10000";
export const CAPE_SENTINEL = -1.0;
export const PBL_VARIABLE = "HPBL_SFC_0";
export const GUST_MAX_PACKING_SLACK_MS = 0.1;

export const SEMANTICS: ForecastSemantics = { gust: "hourMax", precipitation: "instantRate" };

export function fileUrl(
  variable: string,
  date: string,
  runHour: string,
  forecastHour: number,
): string {
  const step = String(forecastHour).padStart(3, "0");
  const name = `CMC_hrdps_west_${variable}_rotated_latlon0.009x0.009_${date}T${runHour}Z_P${step}-00.grib2`;
  return `${BASE_URL}/${runHour}/${step}/${name}`;
}

export function forecastHours(): number[] {
  const hours = Array.from({ length: FORECAST_HOURS }, (_, index) => index + 1);
  const maximum = envMaxSteps();
  return maximum === undefined ? hours : hours.slice(0, maximum);
}

export interface HrdpsWestRun {
  date: string;
  hour: string;
}

export async function latestCompleteRun(
  fetchImpl: TransportFetch = keepAliveFetch,
  now: () => Date = () => new Date(),
): Promise<HrdpsWestRun | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of RUN_HOURS) {
      const probe = fileUrl("TMP_TGL_2", date, hour, FORECAST_HOURS);
      if (await exists(probe, fetchImpl)) {
        return { date, hour };
      }
    }
  }
  return null;
}

export interface BuildProfilesOptions {
  maxSteps?: number;
  wire?: DatamartWire;
  generatedAt?: () => string;
}

export interface BuildProfilesResult {
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
  profiles: ArchivableProfile[];
}

export async function buildProfiles(
  run: HrdpsWestRun,
  referenceTime: string,
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildProfilesOptions = {},
): Promise<BuildProfilesResult> {
  const wire = options.wire ?? liveDatamartWire({ stats });
  try {
    return await sampleProfiles(run, referenceTime, sites, wire, options);
  } finally {
    if (options.wire === undefined) {
      await wire.close?.();
    }
  }
}

async function sampleProfiles(
  run: HrdpsWestRun,
  referenceTime: string,
  sites: readonly Site[],
  wire: DatamartWire,
  options: BuildProfilesOptions,
): Promise<BuildProfilesResult> {
  let hours = forecastHours();
  if (options.maxSteps !== undefined) {
    hours = hours.slice(0, options.maxSteps);
  }
  const forecastSlots = hours.map((hour) => ({
    forecastHour: hour,
    validAt: validTime(referenceTime, hour),
  }));
  const firstForecastHour = forecastSlots[0]!.forecastHour;

  const fetchGate = concurrencyLimit(FETCH_CONCURRENCY);
  const sample = async (
    variable: string,
    forecastHour: number,
  ): Promise<Record<string, number | null>> => {
    const data = await fetchGate(() =>
      wire.fetchBytes(fileUrl(variable, run.date, run.hour, forecastHour)),
    );
    return wire.sampleSites(data, sites);
  };

  const terrain = await sample(TERRAIN_VARIABLE, firstForecastHour);
  const modelElevationBySite: Record<string, number> = Object.fromEntries(
    sites.map((site) => [
      site.slug,
      requiredValue("Datamart", terrain[site.slug], "model elevation", site),
    ]),
  );

  const hoursBySite: Record<string, BuilderHour[]> = Object.fromEntries(
    sites.map((site) => [site.slug, forecastSlots.map((slot) => emptyHour(slot.validAt))]),
  );

  const surfaceTask =
    (hourIndex: number, fieldName: string, variable: string, convert: Convert) =>
    async (): Promise<void> => {
      const values = await sample(variable, forecastSlots[hourIndex]!.forecastHour);
      for (const site of sites) {
        const hour = hoursBySite[site.slug]![hourIndex]!;
        hour[fieldName] = convert(requiredValue("Datamart", values[site.slug], fieldName, site));
      }
    };

  const pressureTask =
    (hourIndex: number, fieldName: string, prefix: string, level: number, convert: Convert) =>
    async (): Promise<void> => {
      const variable = `${prefix}_ISBL_${String(level).padStart(4, "0")}`;
      const values = await sample(variable, forecastSlots[hourIndex]!.forecastHour);
      for (const site of sites) {
        const value = values[site.slug];
        if (value === null || value === undefined) {
          continue;
        }
        const levels = hoursBySite[site.slug]![hourIndex]!.levels;
        const entry = (levels[level] ??= { pressureHpa: level });
        entry[fieldName] = convert(value);
      }
    };

  const gustTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    let hourMax: Record<string, number | null>;
    let instantGust: Record<string, number | null>;
    try {
      hourMax = await sample(GUST_MAX_VARIABLE, forecastHour);
      instantGust = await sample(GUST_INSTANT_VARIABLE, forecastHour);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return; // optional field: the alpha feed may thin out
      }
      throw error;
    }
    for (const site of sites) {
      const slug = site.slug;
      const maxValue = hourMax[slug];
      if (maxValue === null || maxValue === undefined) {
        continue;
      }
      const instantValue = instantGust[slug];
      if (
        instantValue !== null &&
        instantValue !== undefined &&
        maxValue < instantValue - GUST_MAX_PACKING_SLACK_MS
      ) {
        throw new Error(
          `Gust semantics broke for ${site.name} at P${String(forecastHour).padStart(3, "0")}: ` +
            `hour-max ${maxValue.toFixed(2)} m/s < instantaneous ${instantValue.toFixed(2)} m/s`,
        );
      }
      hoursBySite[slug]![hourIndex]!["windGustMps"] = maxValue;
    }
  };

  const capeTask = (hourIndex: number) => async (): Promise<void> => {
    let values: Record<string, number | null>;
    try {
      values = await sample(CAPE_VARIABLE, forecastSlots[hourIndex]!.forecastHour);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return;
      }
      throw error;
    }
    for (const site of sites) {
      const value = values[site.slug];
      if (value === null || value === undefined) {
        continue;
      }
      const masked = maskSentinel(value, CAPE_SENTINEL);
      if (masked !== null) {
        hoursBySite[site.slug]![hourIndex]!["capeJkg"] = masked;
      }
    }
  };

  const pblTask = (hourIndex: number) => async (): Promise<void> => {
    let values: Record<string, number | null>;
    try {
      values = await sample(PBL_VARIABLE, forecastSlots[hourIndex]!.forecastHour);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return;
      }
      throw error;
    }
    for (const site of sites) {
      const value = values[site.slug];
      if (value !== null && value !== undefined) {
        hoursBySite[site.slug]![hourIndex]!["pblHeightM"] = value;
      }
    }
  };

  const tasksForHour = (hourIndex: number): Array<() => Promise<void>> => {
    const tasks: Array<() => Promise<void>> = Object.entries(SURFACE_FIELDS).map(
      ([fieldName, [variable, convert]]) => surfaceTask(hourIndex, fieldName, variable, convert),
    );
    tasks.push(gustTask(hourIndex), capeTask(hourIndex), pblTask(hourIndex));
    for (const level of PRESSURE_LEVELS) {
      for (const [fieldName, [prefix, convert]] of Object.entries(PRESSURE_FIELDS)) {
        tasks.push(pressureTask(hourIndex, fieldName, prefix, level, convert));
      }
    }
    return tasks;
  };

  const lastHourIndex = forecastSlots.length - 1;
  await runConcurrent(tasksForHour(lastHourIndex), TASK_CONCURRENCY);
  await runConcurrent(
    Array.from({ length: lastHourIndex }, (_, index) => tasksForHour(index)).flat(),
    TASK_CONCURRENCY,
  );

  const generatedAt = (options.generatedAt ?? profileInstant)();
  const profiles: ArchivableProfile[] = [];
  for (const site of sites) {
    const sourceHours: SourceHour[] = [];
    for (const hour of hoursBySite[site.slug]!) {
      const levels = Object.values(hour.levels)
        .filter((level) => isCompleteLevel(level))
        .sort((a, b) => a["heightM"]! - b["heightM"]!);
      if (levels.length < 3) {
        throw new Error(`Datamart returned too few pressure levels for ${site.name}`);
      }
      sourceHours.push({ ...hour, levels } as unknown as SourceHour);
    }
    profiles.push(
      deriveSiteForecast(
        {
          generatedAt,
          hours: sourceHours,
          latitude: site.latitude,
          longitude: site.longitude,
          modelElevationM: modelElevationBySite[site.slug]!,
          referenceTime,
          siteId: site.slug,
          siteName: site.name,
          siteTimeZone: site.timeZone,
        },
        SLUG,
        SEMANTICS,
      ) as unknown as ArchivableProfile,
    );
  }
  return {
    firstForecastHour,
    forecastHours: forecastSlots.length,
    lastForecastHour: forecastSlots[lastHourIndex]!.forecastHour,
    profiles,
  };
}

export interface HrdpsWestBuildOptions {
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

export async function buildHrdpsWest(options: HrdpsWestBuildOptions): Promise<boolean> {
  const log = options.log ?? ((line: string) => console.log(line));
  const sitesPath = options.sitesPath;
  const outputRoot = options.outputRoot ?? "data";
  const sites = parseSites(readFileSync(sitesPath, "utf-8"), sitesPath);

  let run: HrdpsWestRun | null;
  let referenceTime: string;
  if (options.referenceTime !== undefined) {
    run = pinnedRun(options.referenceTime);
    referenceTime = options.referenceTime;
  } else {
    run = await latestCompleteRun(options.fetch, options.now);
    if (run === null) {
      log("No complete HRDPS 1 km run is available.");
      return false;
    }
    const date = run.date;
    referenceTime = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${run.hour}:00:00Z`;
  }
  if ((await publishedReferenceTime(SLUG, options.dataset)) === referenceTime) {
    log(`1 km run ${referenceTime} is already published.`);
    return false;
  }

  log(`Building 1 km ${referenceTime} for ${sites.length} sites…`);
  const startedAt = performance.now();
  const stats = new DownloadCounters();
  const buildOptions: BuildProfilesOptions = {};
  if (options.maxSteps !== undefined) buildOptions.maxSteps = options.maxSteps;
  if (options.wire !== undefined) buildOptions.wire = options.wire;
  if (options.generatedAt !== undefined) buildOptions.generatedAt = options.generatedAt;
  const result = await buildProfiles(run, referenceTime, sites, stats, buildOptions);

  const outDir = join(outputRoot, SLUG);
  const sitesDir = join(outDir, "sites");
  mkdirSync(sitesDir, { recursive: true });
  const month = referenceTime.slice(0, 7);
  for (const profile of result.profiles) {
    const document = roundDocument(profile) as ArchivableProfile;
    writeJson(join(sitesDir, `${document.site.id}.json`), document, { compact: true });
    if (options.history ?? true) {
      const published = await publishedHistory(SLUG, document.site.id, month, options.dataset);
      appendHistory(document, join(outDir, "history"), () => published);
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
    `Published ${result.profiles.length} 1 km profiles for ${referenceTime} ` +
      `(${stats.requests} downloads, ${Math.floor(stats.responseBytes / (1024 * 1024))} MiB).`,
  );
  for (const line of stats.transportReport()) {
    log(line);
  }
  return true;
}

export function pinnedRun(referenceTime: string): HrdpsWestRun {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00Z$/.exec(referenceTime);
  if (match === null) {
    throw new Error(
      `referenceTime ${referenceTime} is not an hrdps-west cycle stamp (YYYY-MM-DDTHH:00:00Z)`,
    );
  }
  const hour = match[4]!;
  if (!(RUN_HOURS as readonly string[]).includes(hour)) {
    throw new Error(`referenceTime hour ${hour} is not an hrdps-west cycle (12/00)`);
  }
  return { date: `${match[1]}${match[2]}${match[3]}`, hour };
}
