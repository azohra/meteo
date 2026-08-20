import type { DatasetOptions } from "../dataset.js";
import { NotFoundError } from "../providers/datamart.js";
import { deriveSiteForecast, type SourceHour } from "../derive.js";
import type { ArchivableProfile } from "../history.js";
import { maskSentinel } from "../sentinel.js";
import type { Site } from "../sites.js";
import {
  DownloadCounters,
  exists,
  keepAliveFetch,
  type TransportFetch,
} from "../providers/transport.js";
import {
  KELVIN,
  emptyHour,
  isCompleteLevel,
  parseCycleStamp,
  profileInstant,
  requiredValue,
  runConcurrent,
  runReferenceTime,
  validTime,
  type BuilderHour,
} from "./common.js";
import { publishRun } from "./publication.js";
import { TASK_CONCURRENCY, liveDatamartWire, type DatamartWire } from "../providers/datamart.js";
import { concurrencyLimit } from "../providers/transport.js";
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
  return Array.from({ length: FORECAST_HOURS }, (_, index) => index + 1);
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
  const cap = options.maxSteps;
  if (cap !== undefined) {
    hours = hours.slice(0, cap);
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
  let run: HrdpsWestRun;
  return publishRun(
    {
      slug: SLUG,
      label: "HRDPS 1 km",
      publishedNoun: "HRDPS 1 km profiles",
      resolveRun: async () => {
        if (options.referenceTime !== undefined) {
          run = pinnedRun(options.referenceTime);
          return options.referenceTime;
        }
        const probed = await latestCompleteRun(options.fetch, options.now);
        if (probed === null) {
          return null;
        }
        run = probed;
        return runReferenceTime(probed);
      },
      build: async (referenceTime, sites, stats) => {
        const buildOptions: BuildProfilesOptions = {};
        if (options.maxSteps !== undefined) buildOptions.maxSteps = options.maxSteps;
        if (options.wire !== undefined) buildOptions.wire = options.wire;
        if (options.generatedAt !== undefined) buildOptions.generatedAt = options.generatedAt;
        const result = await buildProfiles(run, referenceTime, sites, stats, buildOptions);
        return { ...result, documents: result.profiles };
      },
    },
    options,
  );
}

export function pinnedRun(referenceTime: string): HrdpsWestRun {
  return parseCycleStamp(referenceTime, RUN_HOURS, "HRDPS 1 km");
}
