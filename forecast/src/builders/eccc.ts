import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import { MANIFEST_SCHEMA_VERSION, type ForecastSemantics } from "@azohra/meteo.briefing/contract";
import { publishedHistory, publishedReferenceTime, type DatasetOptions } from "../dataset.js";
import {
  NotFoundError,
  datamartBase,
  fetchBytes,
  type FetchBytesOptions,
} from "../providers/datamart.js";
import { deriveSiteForecast, type SourceHour } from "../derive.js";
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

export const FETCH_CONCURRENCY = 5;
const J2K_POOL_DEFAULT_MAX_WORKERS = 8;
export const TASK_CONCURRENCY = FETCH_CONCURRENCY + J2K_POOL_DEFAULT_MAX_WORKERS;
export const GUST_MAX_PACKING_SLACK_MS = 0.1;

export const PRESSURE_LEVELS = [
  1015, 1000, 985, 970, 950, 925, 900, 875, 850, 800, 750, 700, 650, 600,
] as const;

export const OLD_STYLE_PRESSURE_PREFIXES: Record<string, string> = {
  dewPointDepressionC: "DEPR",
  heightM: "HGT",
  temperatureC: "TMP",
  verticalVelocityPaS: "VVEL",
  windDirectionDeg: "WDIR",
  windSpeedMps: "WIND",
};
export const ENGLISH_PRESSURE_PREFIXES: Record<string, string> = {
  dewPointDepressionC: "DewPointDepression",
  heightM: "GeopotentialHeight",
  temperatureC: "AirTemp",
  verticalVelocityPaS: "VerticalVelocity",
  windDirectionDeg: "WindDir",
  windSpeedMps: "WindSpeed",
};

export const PRESSURE_FIELDS = [
  "temperatureC",
  "dewPointDepressionC",
  "heightM",
  "windDirectionDeg",
  "windSpeedMps",
] as const;

export function oldStylePressureVariable(fieldName: string, pressureHpa: number): string {
  return `${OLD_STYLE_PRESSURE_PREFIXES[fieldName]}_ISBL_${String(pressureHpa).padStart(4, "0")}`;
}

export function englishPressureVariable(fieldName: string, pressureHpa: number): string {
  return `${ENGLISH_PRESSURE_PREFIXES[fieldName]}_IsbL-${String(pressureHpa).padStart(4, "0")}`;
}

export function allLevels(_forecastHour: number): readonly number[] {
  return PRESSURE_LEVELS;
}

export function allHours(_forecastHour: number): boolean {
  return true;
}

export const GDPS_INTERMEDIATE_LEVELS = [1000, 925, 850, 700] as const;

export function gdpsLevels(forecastHour: number): readonly number[] {
  if (forecastHour <= 168 || forecastHour % 6 === 0) {
    return PRESSURE_LEVELS;
  }
  return GDPS_INTERMEDIATE_LEVELS;
}

export function gdpsCapeHours(forecastHour: number): boolean {
  return forecastHour <= 168 || forecastHour % 6 === 0;
}

export interface DatamartModel {
  slug: string;
  path: string;
  filePrefix: string;
  gridToken: string;
  runHours: readonly string[];
  forecastHours: readonly number[];
  surfaceVariables: Record<string, string>;
  temperatureVariable: string;
  dewPointVariable: string;
  pressureVariable: (fieldName: string, pressureHpa: number) => string;
  omegaLevels: readonly number[];
  terrainVariable: string;
  maxNearestKm: number;
  precipWindowVariable?: string;
  precipRunTotalVariable?: string;
  levelsForHour: (forecastHour: number) => readonly number[];
  gustMaxVariable?: string;
  gustInstantVariable?: string;
  capeVariable?: string;
  cinVariable?: string;
  capeSentinel: number;
  capeForHour: (forecastHour: number) => boolean;
  pblVariable?: string;
}

export function modelSemantics(model: DatamartModel): ForecastSemantics {
  const semantics: ForecastSemantics = { precipitation: "windowMeanRate" };
  return model.gustMaxVariable ? { gust: "hourMax", ...semantics } : semantics;
}

export const HRDPS: DatamartModel = {
  slug: "hrdps-continental",
  path: "model_hrdps/continental/2.5km",
  filePrefix: "MSC_HRDPS",
  gridToken: "RLatLon0.0225",
  runHours: ["18", "12", "06", "00"],
  forecastHours: Array.from({ length: 48 }, (_, index) => index + 1),
  surfaceVariables: {
    cloudCoverPercent: "TCDC_Sfc",
    latentHeatFluxWm2: "LHTFL_Sfc",
    seaLevelPressureHpa: "PRMSL_MSL",
    sensibleHeatFluxWm2: "SHTFL_Sfc",
    windDirectionDeg: "WDIR_AGL-10m",
    windSpeedMps: "WIND_AGL-10m",
  },
  temperatureVariable: "TMP_AGL-2m",
  dewPointVariable: "DPT_AGL-2m",
  pressureVariable: oldStylePressureVariable,
  omegaLevels: [1000, 850, 700],
  terrainVariable: "HGT_Sfc",
  maxNearestKm: 5.0,
  precipWindowVariable: "APCP-Accum1h_Sfc",
  levelsForHour: allLevels,
  gustMaxVariable: "GUST-Max_AGL-10m",
  gustInstantVariable: "GUST_AGL-10m",
  capeVariable: "CAPE_Sfc",
  capeSentinel: -1.0,
  capeForHour: allHours,
  pblVariable: "HPBL_Sfc",
};

export const RDPS: DatamartModel = {
  slug: "rdps",
  path: "model_rdps/10km",
  filePrefix: "MSC_RDPS",
  gridToken: "RLatLon0.09",
  runHours: ["18", "12", "06", "00"],
  forecastHours: Array.from({ length: 84 }, (_, index) => index + 1),
  surfaceVariables: {
    cloudCoverPercent: "TotalCloudCover_Sfc",
    latentHeatFluxWm2: "LatentHeatNetFlux_Sfc",
    seaLevelPressureHpa: "Pressure_MSL",
    sensibleHeatFluxWm2: "SensibleHeatNetFlux_Sfc",
    windDirectionDeg: "WindDir_AGL-10m",
    windSpeedMps: "WindSpeed_AGL-10m",
  },
  temperatureVariable: "AirTemp_AGL-2m",
  dewPointVariable: "DewPoint_AGL-2m",
  pressureVariable: englishPressureVariable,
  omegaLevels: [850, 700],
  terrainVariable: "GeopotentialHeight_Sfc",
  maxNearestKm: 15.0,
  precipWindowVariable: "Precip-Accum1h_Sfc",
  levelsForHour: allLevels,
  gustMaxVariable: "WindGust-Max_AGL-10m",
  gustInstantVariable: "WindGust_AGL-10m",
  capeVariable: "CAPE_Sfc",
  cinVariable: "CIN_Sfc",
  capeSentinel: 9999.0,
  capeForHour: allHours,
  pblVariable: "PlanetaryBoundaryLayerHeight_Sfc",
};

export const GDPS: DatamartModel = {
  slug: "gdps",
  path: "model_gdps/15km",
  filePrefix: "MSC_GDPS",
  gridToken: "LatLon0.15",
  runHours: ["12", "00"],
  forecastHours: Array.from({ length: 80 }, (_, index) => (index + 1) * 3),
  surfaceVariables: {
    cloudCoverPercent: "TotalCloudCover_Sfc",
    latentHeatFluxWm2: "LatentHeatNetFlux_Sfc",
    seaLevelPressureHpa: "Pressure_MSL",
    sensibleHeatFluxWm2: "SensibleHeatNetFlux_Sfc",
    windDirectionDeg: "WindDir_AGL-10m",
    windSpeedMps: "WindSpeed_AGL-10m",
  },
  temperatureVariable: "AirTemp_AGL-2m",
  dewPointVariable: "DewPoint_AGL-2m",
  pressureVariable: englishPressureVariable,
  omegaLevels: [850, 700, 600],
  terrainVariable: "GeopotentialHeight_Sfc",
  maxNearestKm: 25.0,
  precipRunTotalVariable: "Precip-Accum_Sfc",
  levelsForHour: gdpsLevels,
  gustMaxVariable: "WindGust-Max_AGL-10m",
  gustInstantVariable: "WindGust_AGL-10m",
  capeVariable: "CAPE_Sfc",
  cinVariable: "CIN_Sfc",
  capeSentinel: 9999.0,
  capeForHour: gdpsCapeHours,
  pblVariable: "PlanetaryBoundaryLayerHeight_Sfc",
};

export function fileUrl(
  model: DatamartModel,
  date: string,
  runHour: string,
  forecastHour: number,
  variable: string,
): string {
  const step = String(forecastHour).padStart(3, "0");
  const name = `${date}T${runHour}Z_${model.filePrefix}_${variable}_${model.gridToken}_PT${step}H.grib2`;
  return `${datamartBase()}/${date}/WXO-DD/${model.path}/${runHour}/${step}/${name}`;
}

export function concurrencyLimit(maxConcurrent: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next !== undefined) {
      next();
    } else {
      active -= 1;
    }
  };
  return async (task) => {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}

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

export interface DatamartRun {
  date: string;
  hour: string;
}

export async function latestCompleteRun(
  model: DatamartModel,
  fetchImpl: TransportFetch = keepAliveFetch,
  now: () => Date = () => new Date(),
): Promise<DatamartRun | null> {
  const current = now();
  const lastHour = model.forecastHours[model.forecastHours.length - 1]!;
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of model.runHours) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      const probe = fileUrl(model, date, hour, lastHour, model.temperatureVariable);
      if (await exists(probe, fetchImpl)) {
        return { date, hour };
      }
    }
  }
  return null;
}

export function previousScheduledHour(schedule: readonly number[], forecastHour: number): number {
  const index = schedule.indexOf(forecastHour);
  return index > 0 ? schedule[index - 1]! : 0;
}

export async function precipRateForHour(
  accumulated: (forecastHour: number) => Promise<Record<string, number>> | Record<string, number>,
  schedule: readonly number[],
  forecastHour: number,
): Promise<Record<string, number>> {
  const previousHour = previousScheduledHour(schedule, forecastHour);
  const windowHours = forecastHour - previousHour;
  const current = await accumulated(forecastHour);
  const previous = await accumulated(previousHour);
  return Object.fromEntries(
    Object.keys(current).map((slug) => [
      slug,
      Math.max(0.0, current[slug]! - previous[slug]!) / windowHours,
    ]),
  );
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
  model: DatamartModel,
  run: DatamartRun,
  referenceTime: string,
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildProfilesOptions = {},
): Promise<BuildProfilesResult> {
  const wire = options.wire ?? liveDatamartWire({ stats });
  try {
    return await sampleProfiles(model, run, referenceTime, sites, wire, options);
  } finally {
    if (options.wire === undefined) {
      await wire.close?.();
    }
  }
}

async function sampleProfiles(
  model: DatamartModel,
  run: DatamartRun,
  referenceTime: string,
  sites: readonly Site[],
  wire: DatamartWire,
  options: BuildProfilesOptions,
): Promise<BuildProfilesResult> {
  const cap = options.maxSteps ?? envMaxSteps();
  let forecastSlots = model.forecastHours.map((hour) => ({
    forecastHour: hour,
    validAt: validTime(referenceTime, hour),
  }));
  if (cap !== undefined) {
    forecastSlots = forecastSlots.slice(0, cap);
  }

  const fetchGate = concurrencyLimit(FETCH_CONCURRENCY);
  const sample = async (
    variable: string,
    forecastHour: number,
  ): Promise<Record<string, number | null>> => {
    const url = fileUrl(model, run.date, run.hour, forecastHour, variable);
    const message = await fetchGate(() => wire.fetchBytes(url));
    return wire.sampleSites(message, sites, model.maxNearestKm);
  };

  const terrain = await sample(model.terrainVariable, 0);
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
    (hourIndex: number, fieldName: string, variable: string) => async (): Promise<void> => {
      const values = await sample(variable, forecastSlots[hourIndex]!.forecastHour);
      for (const site of sites) {
        const hour = hoursBySite[site.slug]![hourIndex]!;
        let value = requiredValue("Datamart", values[site.slug], fieldName, site);
        if (fieldName === "seaLevelPressureHpa") {
          value /= 100.0;
        }
        hour[fieldName] = value;
      }
    };

  // Depression is computed as T − Td: ECCC clamps its published 2 m
  // depressions at 30 K.
  const temperatureTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const temperature = await sample(model.temperatureVariable, forecastHour);
    const dewPoint = await sample(model.dewPointVariable, forecastHour);
    for (const site of sites) {
      const slug = site.slug;
      const t = requiredValue("Datamart", temperature[slug], "temperatureC", site);
      const d = requiredValue("Datamart", dewPoint[slug], "dewPointC", site);
      const hour = hoursBySite[slug]![hourIndex]!;
      hour.temperatureC = t - KELVIN;
      hour.dewPointDepressionC = t - d;
    }
  };

  const precipWindowTask = (hourIndex: number) => async (): Promise<void> => {
    const values = await sample(
      model.precipWindowVariable!,
      forecastSlots[hourIndex]!.forecastHour,
    );
    for (const site of sites) {
      const hour = hoursBySite[site.slug]![hourIndex]!;
      hour.precipitationMm = requiredValue("Datamart", values[site.slug], "precipitationMm", site);
    }
  };

  const accumulatedByHour = new Map<number, Promise<Record<string, number>>>();
  accumulatedByHour.set(
    0,
    Promise.resolve(Object.fromEntries(sites.map((site) => [site.slug, 0.0]))),
  );

  const accumulatedPrecip = (forecastHour: number): Promise<Record<string, number>> => {
    let pending = accumulatedByHour.get(forecastHour);
    if (pending === undefined) {
      pending = (async () => {
        const values = await sample(model.precipRunTotalVariable!, forecastHour);
        return Object.fromEntries(
          sites.map((site) => [
            site.slug,
            requiredValue("Datamart", values[site.slug], "precipitationMm", site),
          ]),
        );
      })();
      accumulatedByHour.set(forecastHour, pending);
    }
    return pending;
  };

  const precipTotalTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const rates = await precipRateForHour(accumulatedPrecip, model.forecastHours, forecastHour);
    for (const site of sites) {
      hoursBySite[site.slug]![hourIndex]!.precipitationMm = rates[site.slug]!;
    }
  };

  const gustTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    let hourMax: Record<string, number | null>;
    let instantGust: Record<string, number | null>;
    try {
      hourMax = await sample(model.gustMaxVariable!, forecastHour);
      instantGust = await sample(model.gustInstantVariable!, forecastHour);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return;
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
          `Gust semantics broke for ${site.name} at PT${String(forecastHour).padStart(3, "0")}: ` +
            `hour-max ${maxValue.toFixed(2)} m/s < instantaneous ${instantValue.toFixed(2)} m/s`,
        );
      }
      hoursBySite[slug]![hourIndex]!["windGustMps"] = maxValue;
    }
  };

  const capeTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    let cape: Record<string, number | null>;
    let cin: Record<string, number | null> | null;
    try {
      cape = await sample(model.capeVariable!, forecastHour);
      cin = model.cinVariable !== undefined ? await sample(model.cinVariable, forecastHour) : null;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return;
      }
      throw error;
    }
    for (const site of sites) {
      const slug = site.slug;
      const hour = hoursBySite[slug]![hourIndex]!;
      const capeValue = cape[slug];
      if (capeValue !== null && capeValue !== undefined) {
        const value = maskSentinel(capeValue, model.capeSentinel);
        if (value !== null) {
          hour["capeJkg"] = value;
        }
      }
      const cinValue = cin?.[slug];
      if (cinValue !== null && cinValue !== undefined) {
        const value = maskSentinel(cinValue, model.capeSentinel);
        if (value !== null) {
          hour["cinJkg"] = value;
        }
      }
    }
  };

  const pblTask = (hourIndex: number) => async (): Promise<void> => {
    let values: Record<string, number | null>;
    try {
      values = await sample(model.pblVariable!, forecastSlots[hourIndex]!.forecastHour);
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

  const pressureTask =
    (hourIndex: number, fieldName: string, pressureHpa: number) => async (): Promise<void> => {
      const forecastHour = forecastSlots[hourIndex]!.forecastHour;
      let values: Record<string, number | null>;
      try {
        values = await sample(model.pressureVariable(fieldName, pressureHpa), forecastHour);
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
        const levels = hoursBySite[site.slug]![hourIndex]!.levels;
        const entry = (levels[pressureHpa] ??= { pressureHpa });
        entry[fieldName] = fieldName === "temperatureC" ? value - KELVIN : value;
      }
    };

  const tasksForHour = (hourIndex: number): Array<() => Promise<void>> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const tasks: Array<() => Promise<void>> = [temperatureTask(hourIndex)];
    for (const [fieldName, variable] of Object.entries(model.surfaceVariables)) {
      tasks.push(surfaceTask(hourIndex, fieldName, variable));
    }
    if (model.precipWindowVariable !== undefined) {
      tasks.push(precipWindowTask(hourIndex));
    }
    if (model.precipRunTotalVariable !== undefined) {
      tasks.push(precipTotalTask(hourIndex));
    }
    if (model.gustMaxVariable !== undefined) {
      tasks.push(gustTask(hourIndex));
    }
    if (model.capeVariable !== undefined && model.capeForHour(forecastHour)) {
      tasks.push(capeTask(hourIndex));
    }
    if (model.pblVariable !== undefined) {
      tasks.push(pblTask(hourIndex));
    }
    for (const pressureHpa of model.levelsForHour(forecastHour)) {
      for (const fieldName of PRESSURE_FIELDS) {
        tasks.push(pressureTask(hourIndex, fieldName, pressureHpa));
      }
      if (model.omegaLevels.includes(pressureHpa)) {
        tasks.push(pressureTask(hourIndex, "verticalVelocityPaS", pressureHpa));
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
        model.slug,
        modelSemantics(model),
      ) as unknown as ArchivableProfile,
    );
  }
  return {
    firstForecastHour: forecastSlots[0]!.forecastHour,
    forecastHours: forecastSlots.length,
    lastForecastHour: forecastSlots[lastHourIndex]!.forecastHour,
    profiles,
  };
}

export interface EcccBuildOptions {
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

export async function buildEccc(model: DatamartModel, options: EcccBuildOptions): Promise<boolean> {
  const log = options.log ?? ((line: string) => console.log(line));
  const sitesPath = options.sitesPath;
  const outputRoot = options.outputRoot ?? "data";
  const sites = parseSites(readFileSync(sitesPath, "utf-8"), sitesPath);

  let run: DatamartRun | null;
  let referenceTime: string;
  if (options.referenceTime !== undefined) {
    run = pinnedRun(model, options.referenceTime);
    referenceTime = options.referenceTime;
  } else {
    run = await latestCompleteRun(model, options.fetch, options.now);
    if (run === null) {
      log(`No complete ${model.slug} run is available.`);
      return false;
    }
    const date = run.date;
    referenceTime = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${run.hour}:00:00Z`;
  }
  if ((await publishedReferenceTime(model.slug, options.dataset)) === referenceTime) {
    log(`${model.slug} run ${referenceTime} is already published.`);
    return false;
  }

  log(`Building ${model.slug} ${referenceTime} for ${sites.length} sites…`);
  const startedAt = performance.now();
  const stats = new DownloadCounters();
  const buildOptions: BuildProfilesOptions = {};
  if (options.maxSteps !== undefined) buildOptions.maxSteps = options.maxSteps;
  if (options.wire !== undefined) buildOptions.wire = options.wire;
  if (options.generatedAt !== undefined) buildOptions.generatedAt = options.generatedAt;
  const result = await buildProfiles(model, run, referenceTime, sites, stats, buildOptions);

  const outDir = join(outputRoot, model.slug);
  const sitesDir = join(outDir, "sites");
  mkdirSync(sitesDir, { recursive: true });
  const month = referenceTime.slice(0, 7);
  for (const profile of result.profiles) {
    const document = roundDocument(profile) as ArchivableProfile;
    writeJson(join(sitesDir, `${document.site.id}.json`), document, { compact: true });
    if (options.history ?? true) {
      const published = await publishedHistory(
        model.slug,
        document.site.id,
        month,
        options.dataset,
      );
      appendHistory(document, join(outDir, "history"), () => published);
    }
  }
  const manifest = {
    firstForecastHour: result.firstForecastHour,
    forecastHours: result.forecastHours,
    generatedAt: manifestInstant(),
    lastForecastHour: result.lastForecastHour,
    model: model.slug,
    referenceTime,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sites: sites.map((site) => ({ name: site.name, slug: site.slug })),
    stats: manifestStats(stats, startedAt),
  };
  writeJson(join(outDir, "manifest.json"), manifest, { compact: false });
  log(
    `Published ${result.profiles.length} profiles for ${referenceTime} ` +
      `(${stats.requests} downloads, ${Math.floor(stats.responseBytes / (1024 * 1024))} MiB).`,
  );
  for (const line of stats.transportReport()) {
    log(line);
  }
  return true;
}

export function pinnedRun(model: DatamartModel, referenceTime: string): DatamartRun {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00Z$/.exec(referenceTime);
  if (match === null) {
    throw new Error(
      `referenceTime ${referenceTime} is not a ${model.slug} cycle stamp (YYYY-MM-DDTHH:00:00Z)`,
    );
  }
  const hour = match[4]!;
  if (!model.runHours.includes(hour)) {
    throw new Error(
      `referenceTime hour ${hour} is not a ${model.slug} cycle (${model.runHours.join("/")})`,
    );
  }
  return { date: `${match[1]}${match[2]}${match[3]}`, hour };
}
