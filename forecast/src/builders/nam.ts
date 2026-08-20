import {
  MissingRecordError,
  findRecord,
  lambertConeConstant,
  lambertEarthWind,
  pairSpan,
  type IdxRecord,
} from "@azohra/meteo.grib";
import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";
import type { DatasetOptions } from "../dataset.js";
import { deriveSiteForecast, type SourceHour } from "../derive.js";
import type { ArchivableProfile } from "../history.js";
import { dewPointDepression } from "../moisture.js";
import {
  fetchIndex,
  fetchRecord,
  sampleSites,
  sampleSitesUv,
  windFromUv,
  type GridPointValue,
  type NoaaOptions,
  type SampleSite,
} from "../providers/noaa.js";
import type { Site } from "../sites.js";
import { DownloadCounters, exists, type TransportFetch } from "../providers/transport.js";
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
  type BuilderLevel,
} from "./common.js";
import { publishRun } from "./publication.js";

export const BASE_URL = "https://noaa-nam-pds.s3.amazonaws.com";
export const RUN_HOURS = ["18", "12", "06", "00"] as const;
// noaa-nam-pds serves ranged GETs at ~1 s per request, so connections, not
// bandwidth, pace the nest — this gate runs wider than the other NOAA
// builders' 10 for that reason.
export const FETCH_CONCURRENCY = 14;

// NAM publishes PRMSL directly; the PRES:surface record beside it is
// station pressure, not the contract's MSL pressure.
export const SURFACE_FIELDS: Record<string, [variable: string, level: string]> = {
  cloudCoverPercent: ["TCDC", "entire atmosphere (considered as a single layer)"],
  latentHeatFluxWm2: ["LHTFL", "surface"],
  seaLevelPressureHpa: ["PRMSL", "mean sea level"],
  sensibleHeatFluxWm2: ["SHTFL", "surface"],
};
export const OPTIONAL_SURFACE_FIELDS: Record<string, [variable: string, level: string]> = {
  windGustMps: ["GUST", "surface"],
  capeJkg: ["CAPE", "surface"],
  cinJkg: ["CIN", "surface"],
  pblHeightM: ["HPBL", "surface"],
};
export const CLOUD_LAYER_FIELDS: Record<string, [variable: string, level: string]> = {
  lowCloudPercent: ["LCDC", "low cloud layer"],
  midCloudPercent: ["MCDC", "middle cloud layer"],
  highCloudPercent: ["HCDC", "high cloud layer"],
};
export const PRESSURE_LEVELS = [925, 900, 875, 850, 800, 750, 700, 650, 600] as const;
export const OMEGA_LEVELS = PRESSURE_LEVELS;

export const SEMANTICS: ForecastSemantics = {
  gust: "instant",
  precipitation: "windowMeanRate",
};

export interface NamProduct {
  slug: string; // catalogue slug == data/ directory name == CLI token
  label: string; // log prose
  fileToken: string; // the product token in nam.tHHz.<token>NN.tm00.grib2
  forecastHours: readonly number[];
  hourlyThrough: number; // last hour of the hourly cadence; 3-hourly beyond
  bucketResetHours: number; // APCP bucket length on the 00/12Z cycles
  offCycleBucketResetHours: number; // APCP bucket length on 06/18Z
  lambertOrientationDeg: number; // LoV
  lambertCone: number; // sin(Latin1); one standard parallel on both grids
  maxNearestKm: number;
  cloudFileToken: string | null; // layered cloud companion file, if separate
}

function range(start: number, stop: number, step = 1): number[] {
  const values: number[] = [];
  for (let value = start; value < stop; value += step) {
    values.push(value);
  }
  return values;
}

export const PRODUCTS: Record<string, NamProduct> = {
  "nam-conus-nest": {
    slug: "nam-conus-nest",
    label: "NAM CONUS nest",
    fileToken: "conusnest.hiresf",
    forecastHours: range(1, 61),
    hourlyThrough: 60,
    bucketResetHours: 3,
    offCycleBucketResetHours: 3,
    lambertOrientationDeg: 262.5,
    lambertCone: lambertConeConstant(38.5, 38.5),
    maxNearestKm: 5.0,
    cloudFileToken: null,
  },
  nam: {
    slug: "nam",
    label: "NAM 12 km",
    fileToken: "awphys",
    forecastHours: [...range(1, 37), ...range(39, 85, 3)],
    hourlyThrough: 36,
    bucketResetHours: 12,
    offCycleBucketResetHours: 3,
    lambertOrientationDeg: 265.0,
    lambertCone: lambertConeConstant(25.0, 25.0),
    maxNearestKm: 15.0,
    cloudFileToken: "awip12",
  },
};

export interface NamRun {
  date: string;
  hour: string;
}

export function fileUrl(
  fileToken: string,
  date: string,
  runHour: string,
  forecastHour: number,
): string {
  const step = String(forecastHour).padStart(2, "0");
  return `${BASE_URL}/nam.${date}/nam.t${runHour}z.${fileToken}${step}.tm00.grib2`;
}

export function completionUrls(product: NamProduct, date: string, runHour: string): string[] {
  const last = product.forecastHours[product.forecastHours.length - 1]!;
  const urls = [fileUrl(product.fileToken, date, runHour, last) + ".idx"];
  if (product.cloudFileToken !== null) {
    urls.push(fileUrl(product.cloudFileToken, date, runHour, last) + ".idx");
  }
  return urls;
}

export async function latestCompleteRun(
  product: NamProduct,
  fetchImpl: TransportFetch = globalThis.fetch,
  now: () => Date = () => new Date(),
): Promise<NamRun | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of RUN_HOURS) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      let complete = true;
      for (const url of completionUrls(product, date, hour)) {
        if (!(await exists(url, fetchImpl))) {
          complete = false;
          break;
        }
      }
      if (complete) {
        return { date, hour };
      }
    }
  }
  return null;
}

export function precipFetches(
  product: NamProduct,
  runHour: string,
  forecastHour: number,
): [fetches: Array<[fileHour: number, forecast: string]>, windowHours: number] {
  if (forecastHour > product.hourlyThrough) {
    return [[[forecastHour, `${forecastHour - 3}-${forecastHour} hour acc fcst`]], 3];
  }
  const reset =
    runHour === "00" || runHour === "12"
      ? product.bucketResetHours
      : product.offCycleBucketResetHours;
  const start = Math.floor((forecastHour - 1) / reset) * reset;
  const current: [number, string] = [forecastHour, `${start}-${forecastHour} hour acc fcst`];
  if (forecastHour - start === 1) {
    return [[current], 1];
  }
  return [[current, [forecastHour - 1, `${start}-${forecastHour - 1} hour acc fcst`]], 1];
}

export interface NamWire {
  fetchIndex(url: string): Promise<IdxRecord[]>;
  fetchRecord(url: string, record: IdxRecord): Promise<unknown>;
  sampleSites(
    message: unknown,
    sites: readonly SampleSite[],
    maxDistanceKm: number,
  ): Record<string, GridPointValue>;
  sampleSitesUv(
    message: unknown,
    sites: readonly SampleSite[],
    maxDistanceKm: number,
  ): [Record<string, GridPointValue>, Record<string, GridPointValue>];
}

function liveWire(options: NoaaOptions): NamWire {
  return {
    fetchIndex: (url) => fetchIndex(url, options),
    fetchRecord: (url, record) => fetchRecord(url, record, options),
    sampleSites: (message, sites, maxDistanceKm) =>
      sampleSites(message as Uint8Array, sites, maxDistanceKm),
    sampleSitesUv: (message, sites, maxDistanceKm) =>
      sampleSitesUv(message as Uint8Array, sites, maxDistanceKm),
  };
}

export interface BuildProfilesOptions {
  maxSteps?: number;
  wire?: NamWire;
  generatedAt?: () => string;
}

export interface BuildProfilesResult {
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
  profiles: ArchivableProfile[];
}

export async function buildProfiles(
  product: NamProduct,
  run: NamRun,
  referenceTime: string,
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildProfilesOptions = {},
): Promise<BuildProfilesResult> {
  const wire = options.wire ?? liveWire({ stats });
  const cap = options.maxSteps;
  const forecastSlots = product.forecastHours
    .map((hour) => ({ forecastHour: hour, validAt: validTime(referenceTime, hour) }))
    .slice(0, cap);
  const firstForecastHour = forecastSlots[0]!.forecastHour;

  const recordsByHour = new Map<number, IdxRecord[]>();
  const cloudRecordsByHour = new Map<number, IdxRecord[]>();

  const indexTask =
    (forecastHour: number, fileToken: string, store: Map<number, IdxRecord[]>) =>
    async (): Promise<void> => {
      const url = fileUrl(fileToken, run.date, run.hour, forecastHour) + ".idx";
      store.set(forecastHour, await wire.fetchIndex(url));
    };

  const indexTasks = forecastSlots.map((slot) =>
    indexTask(slot.forecastHour, product.fileToken, recordsByHour),
  );
  if (product.cloudFileToken !== null) {
    const cloudFileToken = product.cloudFileToken;
    indexTasks.push(
      ...forecastSlots.map((slot) =>
        indexTask(slot.forecastHour, cloudFileToken, cloudRecordsByHour),
      ),
    );
  }
  await runConcurrent(indexTasks, FETCH_CONCURRENCY);

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
    const data = await wire.fetchRecord(
      fileUrl(product.fileToken, run.date, run.hour, forecastHour),
      record,
    );
    return wire.sampleSites(data, sites, product.maxNearestKm);
  };

  const windValues = async (
    forecastHour: number,
    level: string,
  ): Promise<Record<string, [number, number] | null>> => {
    const forecast = `${forecastHour} hour fcst`;
    const records = recordsByHour.get(forecastHour)!;
    const uRecord = findRecord(records, "UGRD", level, forecast);
    const vRecord = findRecord(records, "VGRD", level, forecast);
    const url = fileUrl(product.fileToken, run.date, run.hour, forecastHour);
    let u: Record<string, GridPointValue>;
    let v: Record<string, GridPointValue>;
    if (uRecord.offset === vRecord.offset) {
      const data = await wire.fetchRecord(url, pairSpan(uRecord, vRecord));
      [u, v] = wire.sampleSitesUv(data, sites, product.maxNearestKm);
    } else {
      u = wire.sampleSites(await wire.fetchRecord(url, uRecord), sites, product.maxNearestKm);
      v = wire.sampleSites(await wire.fetchRecord(url, vRecord), sites, product.maxNearestKm);
    }
    const winds: Record<string, [number, number] | null> = {};
    for (const site of sites) {
      const slug = site.slug;
      const uSample = u[slug]!;
      const vSample = v[slug]!;
      if (uSample.value === null || vSample.value === null) {
        winds[slug] = null;
        continue;
      }
      const [uEarth, vEarth] = lambertEarthWind(
        uSample.value,
        vSample.value,
        uSample.longitude,
        product.lambertOrientationDeg,
        product.lambertCone,
      );
      winds[slug] = windFromUv(uEarth, vEarth);
    }
    return winds;
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
    const winds = await windValues(forecastSlots[hourIndex]!.forecastHour, "10 m above ground");
    for (const site of sites) {
      const slug = site.slug;
      const wind = winds[slug];
      if (wind === null || wind === undefined) {
        throw new Error(`NOAA returned no 10 m wind for ${site.name}`);
      }
      const hour = hoursBySite[slug]![hourIndex]!;
      [hour.windSpeedMps, hour.windDirectionDeg] = wind;
    }
  };

  const precipitationTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const [fetches, windowHours] = precipFetches(product, run.hour, forecastHour);
    const samples: Array<Record<string, GridPointValue>> = [];
    for (const [fileHour, forecast] of fetches) {
      samples.push(await recordValues(fileHour, "APCP", "surface", forecast));
    }
    for (const site of sites) {
      const slug = site.slug;
      let millimetres = requiredValue("NOAA", samples[0]![slug]!.value, "precipitationMm", site);
      if (samples.length === 2) {
        millimetres -= requiredValue("NOAA", samples[1]![slug]!.value, "precipitationMm", site);
      }
      const hour = hoursBySite[slug]![hourIndex]!;
      hour.precipitationMm = millimetres / windowHours;
    }
  };

  const optionalSurfaceTask =
    (
      hourIndex: number,
      fieldName: string,
      variable: string,
      level: string,
      records: Map<number, IdxRecord[]>,
      fileToken: string,
    ) =>
    async (): Promise<void> => {
      const forecastHour = forecastSlots[hourIndex]!.forecastHour;
      let record: IdxRecord;
      try {
        record = findRecord(
          records.get(forecastHour)!,
          variable,
          level,
          `${forecastHour} hour fcst`,
        );
      } catch (error) {
        if (isMissingRecord(error)) {
          return; // optional field: absence stays out of the document
        }
        throw error;
      }
      const data = await wire.fetchRecord(
        fileUrl(fileToken, run.date, run.hour, forecastHour),
        record,
      );
      const values = wire.sampleSites(data, sites, product.maxNearestKm);
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
    const winds = await windValues(forecastHour, level);
    let omega: Record<string, GridPointValue> | null = null;
    try {
      omega = await recordValues(forecastHour, "VVEL", level);
    } catch (error) {
      if (!isMissingRecord(error)) {
        throw error; // optional field: absence stays out of the document
      }
    }
    for (const site of sites) {
      const slug = site.slug;
      const t = temperature[slug]!.value;
      const rh = humidity[slug]!.value;
      const h = height[slug]!.value;
      const wind = winds[slug];
      if (t === null || rh === null || h === null || wind === null || wind === undefined) {
        continue;
      }
      const entry: BuilderLevel = {
        pressureHpa,
        heightM: h,
        temperatureC: t - KELVIN,
        dewPointDepressionC: dewPointDepression(t - KELVIN, rh),
        windDirectionDeg: wind[1],
        windSpeedMps: wind[0],
      };
      if (omega !== null && omega[slug]!.value !== null) {
        entry["verticalVelocityPaS"] = omega[slug]!.value!;
      }
      hoursBySite[slug]![hourIndex]!.levels[pressureHpa] = entry;
    }
  };

  const cloudRecords = product.cloudFileToken !== null ? cloudRecordsByHour : recordsByHour;
  const cloudFileToken = product.cloudFileToken ?? product.fileToken;

  const tasksForHour = (hourIndex: number): Array<() => Promise<void>> => [
    temperatureTask(hourIndex),
    surfaceWindTask(hourIndex),
    precipitationTask(hourIndex),
    ...Object.entries(SURFACE_FIELDS).map(([fieldName, [variable, level]]) =>
      surfaceTask(hourIndex, fieldName, variable, level),
    ),
    ...Object.entries(OPTIONAL_SURFACE_FIELDS).map(([fieldName, [variable, level]]) =>
      optionalSurfaceTask(hourIndex, fieldName, variable, level, recordsByHour, product.fileToken),
    ),
    ...Object.entries(CLOUD_LAYER_FIELDS).map(([fieldName, [variable, level]]) =>
      optionalSurfaceTask(hourIndex, fieldName, variable, level, cloudRecords, cloudFileToken),
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
        product.slug,
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

export interface NamBuildOptions {
  sitesPath: string;
  history?: boolean;
  outputRoot?: string;
  maxSteps?: number;
  referenceTime?: string;
  dataset?: DatasetOptions;
  wire?: NamWire;
  fetch?: TransportFetch;
  log?: (line: string) => void;
  now?: () => Date;
  generatedAt?: () => string;
}

export async function buildNam(product: NamProduct, options: NamBuildOptions): Promise<boolean> {
  let run: NamRun;
  return publishRun(
    {
      slug: product.slug,
      label: product.label,
      publishedNoun: `${product.label} profiles`,
      resolveRun: async () => {
        if (options.referenceTime !== undefined) {
          run = pinnedRun(options.referenceTime);
          return options.referenceTime;
        }
        const probed = await latestCompleteRun(product, options.fetch, options.now);
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
        const result = await buildProfiles(product, run, referenceTime, sites, stats, buildOptions);
        return { ...result, documents: result.profiles };
      },
    },
    options,
  );
}

function pinnedRun(referenceTime: string): NamRun {
  return parseCycleStamp(referenceTime, RUN_HOURS, "NAM");
}
