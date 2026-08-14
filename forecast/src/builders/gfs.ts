import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MissingRecordError, findRecord, type IdxRecord } from "@azohra/meteo.grib";
import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";
import { publishedHistory, publishedReferenceTime, type DatasetOptions } from "../dataset.js";
import { SCHEMA_VERSION, deriveSiteForecast, type SourceHour } from "../derive.js";
import { appendHistory, type ArchivableProfile } from "../history.js";
import { dewPointDepression } from "../moisture.js";
import {
  fetchIndex,
  fetchRecord,
  sampleSites,
  windFromUv,
  type GridPointValue,
  type NoaaOptions,
  type SampleSite,
} from "../providers/noaa.js";
import { manifestStats, roundDocument, writeJson } from "../publish.js";
import { parseSites, type Site } from "../sites.js";
import { DownloadCounters, exists, type TransportFetch } from "../providers/transport.js";
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
  type BuilderLevel,
} from "./common.js";

export const SLUG = "gfs";
export const BASE_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
export const RUN_HOURS = ["18", "12", "06", "00"] as const;
export const STEP_HOURS = 3;
export const LAST_FORECAST_HOUR = 384;
export const FETCH_CONCURRENCY = 10;
export const MAX_NEAREST_KM = 30.0;

export const SURFACE_FIELDS: Record<string, [variable: string, level: string]> = {
  cloudCoverPercent: ["TCDC", "entire atmosphere"],
  seaLevelPressureHpa: ["PRMSL", "mean sea level"],
};
export const OPTIONAL_SURFACE_FIELDS: Record<string, [variable: string, level: string]> = {
  windGustMps: ["GUST", "surface"],
  capeJkg: ["CAPE", "surface"],
  cinJkg: ["CIN", "surface"],
  pblHeightM: ["HPBL", "surface"],
  lowCloudPercent: ["LCDC", "low cloud layer"],
  midCloudPercent: ["MCDC", "middle cloud layer"],
  highCloudPercent: ["HCDC", "high cloud layer"],
};
export const PRESSURE_LEVELS = [925, 900, 850, 800, 750, 700, 650, 600] as const;
export const OMEGA_LEVELS = PRESSURE_LEVELS;

export const SEMANTICS: ForecastSemantics = {
  gust: "instant",
  precipitation: "windowMeanRate",
};

export interface GfsRun {
  date: string;
  hour: string;
}

export interface GfsWire {
  fetchIndex(url: string): Promise<IdxRecord[]>;
  fetchRecord(url: string, record: IdxRecord): Promise<unknown>;
  sampleSites(
    message: unknown,
    sites: readonly SampleSite[],
    maxDistanceKm: number,
  ): Record<string, GridPointValue>;
}

function liveWire(options: NoaaOptions): GfsWire {
  return {
    fetchIndex: (url) => fetchIndex(url, options),
    fetchRecord: (url, record) => fetchRecord(url, record, options),
    sampleSites: (message, sites, maxDistanceKm) =>
      sampleSites(message as Uint8Array, sites, maxDistanceKm),
  };
}

export function fileUrl(date: string, runHour: string, forecastHour: number): string {
  const step = String(forecastHour).padStart(3, "0");
  return `${BASE_URL}/gfs.${date}/${runHour}/atmos/gfs.t${runHour}z.pgrb2.0p25.f${step}`;
}

export async function latestCompleteRun(
  fetchImpl: TransportFetch = globalThis.fetch,
  now: () => Date = () => new Date(),
): Promise<GfsRun | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of RUN_HOURS) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      if (await exists(fileUrl(date, hour, LAST_FORECAST_HOUR) + ".idx", fetchImpl)) {
        return { date, hour };
      }
    }
  }
  return null;
}

export function windowStart(forecastHour: number): number {
  return Math.floor((forecastHour - STEP_HOURS) / 6) * 6;
}

export function deaveraged(current: number, companion: number): number {
  return 2 * current - companion;
}

export function differenced(current: number, companion: number): number {
  return current - companion;
}

export interface BuildProfilesOptions {
  maxSteps?: number;
  wire?: GfsWire;
  generatedAt?: () => string;
}

export interface BuildProfilesResult {
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
  profiles: ArchivableProfile[];
}

export async function buildProfiles(
  run: GfsRun,
  referenceTime: string,
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildProfilesOptions = {},
): Promise<BuildProfilesResult> {
  const wire = options.wire ?? liveWire({ stats });
  const cap = options.maxSteps ?? envMaxSteps();
  let forecastSlots = [];
  for (let hour = STEP_HOURS; hour <= LAST_FORECAST_HOUR; hour += STEP_HOURS) {
    forecastSlots.push({ forecastHour: hour, validAt: validTime(referenceTime, hour) });
  }
  forecastSlots = forecastSlots.slice(0, cap);
  const firstForecastHour = forecastSlots[0]!.forecastHour;

  const indexHours = [
    ...new Set([
      ...forecastSlots.map((slot) => slot.forecastHour),
      ...forecastSlots
        .filter((slot) => windowStart(slot.forecastHour) !== slot.forecastHour - STEP_HOURS)
        .map((slot) => slot.forecastHour - STEP_HOURS),
    ]),
  ].sort((a, b) => a - b);
  const recordsByHour = new Map<number, IdxRecord[]>();

  const indexTask = (forecastHour: number) => async (): Promise<void> => {
    const url = fileUrl(run.date, run.hour, forecastHour) + ".idx";
    recordsByHour.set(forecastHour, await wire.fetchIndex(url));
  };

  await runConcurrent(indexHours.map(indexTask), FETCH_CONCURRENCY);

  const recordValues = async (
    forecastHour: number,
    variable: string,
    level: string,
    forecast?: string,
  ): Promise<Record<string, GridPointValue>> => {
    const record = findRecord(
      recordsByHour.get(forecastHour)!,
      variable,
      level,
      forecast ?? `${forecastHour} hour fcst`,
    );
    const data = await wire.fetchRecord(fileUrl(run.date, run.hour, forecastHour), record);
    return wire.sampleSites(data, sites, MAX_NEAREST_KM);
  };

  const windowedValues = async (
    variable: string,
    kind: string,
    fileHour: number,
  ): Promise<Record<string, number | null>> => {
    const forecast = `${windowStart(fileHour)}-${fileHour} hour ${kind} fcst`;
    const samples = await recordValues(fileHour, variable, "surface", forecast);
    return Object.fromEntries(
      Object.entries(samples).map(([slug, sample]) => [slug, sample.value]),
    );
  };

  const threeHourValues = async (
    variable: string,
    kind: string,
    targetHour: number,
  ): Promise<Record<string, number | null>> => {
    const current = await windowedValues(variable, kind, targetHour);
    if (windowStart(targetHour) === targetHour - STEP_HOURS) {
      return current;
    }
    const companion = await windowedValues(variable, kind, targetHour - STEP_HOURS);
    const recover = kind === "ave" ? deaveraged : differenced;
    return Object.fromEntries(
      Object.keys(current).map((slug) => [
        slug,
        current[slug] === null || companion[slug] === null
          ? null
          : recover(current[slug]!, companion[slug]!),
      ]),
    );
  };

  const terrain = await recordValues(firstForecastHour, "HGT", "surface");
  const modelElevationBySite: Record<string, number> = Object.fromEntries(
    sites.map((site) => [
      site.slug,
      requiredValue("NOAA", terrain[site.slug]!.value, "model elevation", site),
    ]),
  );

  const hoursBySite: Record<string, BuilderHour[]> = Object.fromEntries(
    sites.map((site) => [site.slug, forecastSlots.map((slot) => emptyHour(slot.validAt))]),
  );

  const surfaceTask =
    (hourIndex: number, fieldName: string, variable: string, level: string) =>
    async (): Promise<void> => {
      const values = await recordValues(forecastSlots[hourIndex]!.forecastHour, variable, level);
      for (const site of sites) {
        const hour = hoursBySite[site.slug]![hourIndex]!;
        let value = requiredValue("NOAA", values[site.slug]!.value, fieldName, site);
        if (fieldName === "seaLevelPressureHpa") {
          value /= 100.0;
        }
        hour[fieldName] = value;
      }
    };

  const temperatureTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const temperature = await recordValues(forecastHour, "TMP", "2 m above ground");
    const dewPoint = await recordValues(forecastHour, "DPT", "2 m above ground");
    for (const site of sites) {
      const slug = site.slug;
      const t = requiredValue("NOAA", temperature[slug]!.value, "temperatureC", site);
      const d = requiredValue("NOAA", dewPoint[slug]!.value, "dewPointDepressionC", site);
      const hour = hoursBySite[slug]![hourIndex]!;
      hour.temperatureC = t - KELVIN;
      hour.dewPointDepressionC = t - d;
    }
  };

  const surfaceWindTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const u = await recordValues(forecastHour, "UGRD", "10 m above ground");
    const v = await recordValues(forecastHour, "VGRD", "10 m above ground");
    for (const site of sites) {
      const slug = site.slug;
      const hour = hoursBySite[slug]![hourIndex]!;
      [hour.windSpeedMps, hour.windDirectionDeg] = windFromUv(
        requiredValue("NOAA", u[slug]!.value, "windSpeedMps", site),
        requiredValue("NOAA", v[slug]!.value, "windSpeedMps", site),
      );
    }
  };

  const fluxTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    for (const [fieldName, variable] of [
      ["latentHeatFluxWm2", "LHTFL"],
      ["sensibleHeatFluxWm2", "SHTFL"],
    ] as const) {
      const means = await threeHourValues(variable, "ave", forecastHour);
      for (const site of sites) {
        const hour = hoursBySite[site.slug]![hourIndex]!;
        hour[fieldName] = requiredValue("NOAA", means[site.slug], fieldName, site);
      }
    }
  };

  const precipitationTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const accumulations = await threeHourValues("APCP", "acc", forecastHour);
    for (const site of sites) {
      const hour = hoursBySite[site.slug]![hourIndex]!;
      hour.precipitationMm =
        requiredValue("NOAA", accumulations[site.slug], "precipitationMm", site) / 3.0;
    }
  };

  const optionalSurfaceTask =
    (hourIndex: number, fieldName: string, variable: string, level: string) =>
    async (): Promise<void> => {
      const forecastHour = forecastSlots[hourIndex]!.forecastHour;
      let values: Record<string, GridPointValue>;
      try {
        values = await recordValues(forecastHour, variable, level);
      } catch (error) {
        if (isMissingRecord(error)) {
          return; // optional field: absence stays out of the document
        }
        throw error;
      }
      for (const site of sites) {
        const value = values[site.slug]!.value;
        if (value !== null) {
          hoursBySite[site.slug]![hourIndex]![fieldName] = value;
        }
      }
    };

  const pressureTask = (hourIndex: number, pressureHpa: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const level = `${pressureHpa} mb`;
    const temperature = await recordValues(forecastHour, "TMP", level);
    const humidity = await recordValues(forecastHour, "RH", level);
    const height = await recordValues(forecastHour, "HGT", level);
    const u = await recordValues(forecastHour, "UGRD", level);
    const v = await recordValues(forecastHour, "VGRD", level);
    let cloud: Record<string, GridPointValue> | null = null;
    try {
      cloud = await recordValues(forecastHour, "TCDC", level);
    } catch (error) {
      if (!isMissingRecord(error)) {
        throw error;
      }
    }
    let omega: Record<string, GridPointValue> | null = null;
    if ((OMEGA_LEVELS as readonly number[]).includes(pressureHpa)) {
      try {
        omega = await recordValues(forecastHour, "VVEL", level);
      } catch (error) {
        if (!isMissingRecord(error)) {
          throw error; // optional field: absence stays out of the document
        }
      }
    }
    for (const site of sites) {
      const slug = site.slug;
      const t = temperature[slug]!.value;
      const rh = humidity[slug]!.value;
      const h = height[slug]!.value;
      if (
        t === null ||
        rh === null ||
        h === null ||
        u[slug]!.value === null ||
        v[slug]!.value === null
      ) {
        continue;
      }
      const [speed, direction] = windFromUv(u[slug]!.value!, v[slug]!.value!);
      const entry: BuilderLevel = {
        pressureHpa,
        heightM: h,
        temperatureC: t - KELVIN,
        dewPointDepressionC: dewPointDepression(t - KELVIN, rh),
        windDirectionDeg: direction,
        windSpeedMps: speed,
      };
      if (cloud !== null && cloud[slug]!.value !== null) {
        entry["cloudFractionPercent"] = cloud[slug]!.value!;
      }
      if (omega !== null && omega[slug]!.value !== null) {
        entry["verticalVelocityPaS"] = omega[slug]!.value!;
      }
      hoursBySite[slug]![hourIndex]!.levels[pressureHpa] = entry;
    }
  };

  const tasksForHour = (hourIndex: number): Array<() => Promise<void>> => [
    temperatureTask(hourIndex),
    surfaceWindTask(hourIndex),
    fluxTask(hourIndex),
    precipitationTask(hourIndex),
    ...Object.entries(SURFACE_FIELDS).map(([fieldName, [variable, level]]) =>
      surfaceTask(hourIndex, fieldName, variable, level),
    ),
    ...Object.entries(OPTIONAL_SURFACE_FIELDS).map(([fieldName, [variable, level]]) =>
      optionalSurfaceTask(hourIndex, fieldName, variable, level),
    ),
    ...PRESSURE_LEVELS.map((level) => pressureTask(hourIndex, level)),
  ];

  await runConcurrent(
    forecastSlots.flatMap((_slot, index) => tasksForHour(index)),
    FETCH_CONCURRENCY,
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
        throw new Error(`NOAA returned too few pressure levels for ${site.name}`);
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
    lastForecastHour: forecastSlots[forecastSlots.length - 1]!.forecastHour,
    profiles,
  };
}

function isMissingRecord(error: unknown): boolean {
  return error instanceof MissingRecordError;
}

export interface GfsBuildOptions {
  sitesPath: string;
  history?: boolean;
  outputRoot?: string;
  maxSteps?: number;
  referenceTime?: string;
  dataset?: DatasetOptions;
  wire?: GfsWire;
  fetch?: TransportFetch;
  log?: (line: string) => void;
  now?: () => Date;
  generatedAt?: () => string;
}

export async function buildGfs(options: GfsBuildOptions): Promise<boolean> {
  const log = options.log ?? ((line: string) => console.log(line));
  const sitesPath = options.sitesPath;
  const outputRoot = options.outputRoot ?? "data";
  const sites = parseSites(readFileSync(sitesPath, "utf-8"), sitesPath);

  let run: GfsRun | null;
  let referenceTime: string;
  if (options.referenceTime !== undefined) {
    run = pinnedRun(options.referenceTime);
    referenceTime = options.referenceTime;
  } else {
    run = await latestCompleteRun(options.fetch, options.now);
    if (run === null) {
      log("No complete GFS run is available.");
      return false;
    }
    const date = run.date;
    referenceTime = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${run.hour}:00:00Z`;
  }
  if ((await publishedReferenceTime(SLUG, options.dataset)) === referenceTime) {
    log(`GFS run ${referenceTime} is already published.`);
    return false;
  }

  log(`Building GFS ${referenceTime} for ${sites.length} sites…`);
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
    `Published ${result.profiles.length} GFS profiles for ${referenceTime} ` +
      `(${stats.requests} requests, ${Math.floor(stats.responseBytes / (1024 * 1024))} MiB).`,
  );
  for (const line of stats.transportReport()) {
    log(line);
  }
  return true;
}

function pinnedRun(referenceTime: string): GfsRun {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00Z$/.exec(referenceTime);
  if (match === null) {
    throw new Error(
      `referenceTime ${referenceTime} is not a GFS cycle stamp (YYYY-MM-DDTHH:00:00Z)`,
    );
  }
  const hour = match[4]!;
  if (!(RUN_HOURS as readonly string[]).includes(hour)) {
    throw new Error(`referenceTime hour ${hour} is not a GFS cycle (00/06/12/18)`);
  }
  return { date: `${match[1]}${match[2]}${match[3]}`, hour };
}
