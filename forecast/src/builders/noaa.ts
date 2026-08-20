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

export interface NoaaWire {
  fetchIndex(url: string): Promise<IdxRecord[]>;
  fetchRecord(url: string, record: IdxRecord): Promise<unknown>;
  sampleSites(
    message: unknown,
    sites: readonly SampleSite[],
    maxDistanceKm: number,
  ): Record<string, GridPointValue>;
  sampleSitesUv?(
    message: unknown,
    sites: readonly SampleSite[],
    maxDistanceKm: number,
  ): [Record<string, GridPointValue>, Record<string, GridPointValue>];
}

function liveWire(options: NoaaOptions): NoaaWire {
  return {
    fetchIndex: (url) => fetchIndex(url, options),
    fetchRecord: (url, record) => fetchRecord(url, record, options),
    sampleSites: (message, sites, maxDistanceKm) =>
      sampleSites(message as Uint8Array, sites, maxDistanceKm),
    sampleSitesUv: (message, sites, maxDistanceKm) =>
      sampleSitesUv(message as Uint8Array, sites, maxDistanceKm),
  };
}

/** What a model-specific hour task may reach: samples from the surface
 * file's records (any file hour, for windowed companions) and field
 * writes into the hour under construction. */
export interface NoaaHourTools {
  forecastHour: number;
  runHour: string;
  sites: readonly Site[];
  values(
    fileHour: number,
    variable: string,
    level: string,
    forecast?: string,
  ): Promise<Record<string, GridPointValue>>;
  set(siteSlug: string, fieldName: string, value: number): void;
}

export type NoaaHourTask = (tools: NoaaHourTools) => Promise<void>;

type Convert = (value: number) => number;

/**
 * One NOAA idx-record model: the provider facts the shared engine below
 * consumes. File tokens name the distinct GRIB files a run publishes
 * (RRFS prslev/2dfld, NAM's layered-cloud companion); single-file models
 * use "" and their fileUrl ignores the token.
 */
export interface NoaaModel {
  slug: string;
  label: string;
  /** The pinned-cycle grammar's name; both NAM products pin as "NAM". */
  cycleName: string;
  runHours: readonly string[];
  forecastHours: readonly number[];
  fetchConcurrency: number;
  maxNearestKm: number;
  semantics: ForecastSemantics;
  pressureLevels: readonly number[];
  surfaceToken: string;
  pressureToken: string;
  /** Layered-cloud companion file; absent means the surface file carries them. */
  cloudLayerToken?: string;
  fileUrl(token: string, date: string, runHour: string, forecastHour: number): string;
  completionUrls(date: string, runHour: string): string[];
  /** Extra surface-file index hours beyond the slots (GFS windowed companions). */
  extraIndexHours?(slotHours: readonly number[]): number[];
  surfaceFields: Record<string, [variable: string, level: string, convert: Convert]>;
  optionalSurfaceFields: Record<string, [variable: string, level: string]>;
  /** Cloud-layer fields read from cloudLayerToken's file (NAM); others carry
   * them in optionalSurfaceFields. */
  cloudLayerFields?: Record<string, [variable: string, level: string]>;
  smokeFields?: Record<
    string,
    [variable: string, level: string, qualifier: string | undefined, convert: Convert]
  >;
  /** True: the level file carries DPT; false: RH, inverted through Magnus. */
  levelDewPoint: boolean;
  /** GFS publishes TCDC per pressure level. */
  levelCloudFraction?: boolean;
  verticalVelocity: {
    variable: string;
    levels: readonly number[];
    /** RRFS publishes geometric DZDT; the hydrostatic conversion to omega. */
    toOmega?: (wMps: number, pressureHpa: number, temperatureK: number) => number;
  };
  /** Lambert-conformal wind rotation; absent on lat-lon grids (GFS). */
  lambert?: { orientationDeg: number; cone: number };
  /** Coalesce adjacent U/V records into one ranged GET (NAM's slow host). */
  pairSpanUv?: boolean;
  /** Model-specific per-hour work: precipitation algebra, GFS's windowed fluxes. */
  hourTasks: readonly NoaaHourTask[];
}

function range(start: number, stop: number, step = 1): number[] {
  const values: number[] = [];
  for (let value = start; value < stop; value += step) {
    values.push(value);
  }
  return values;
}

export interface NoaaRun {
  date: string;
  hour: string;
}

export async function latestCompleteRun(
  model: NoaaModel,
  fetchImpl: TransportFetch = globalThis.fetch,
  now: () => Date = () => new Date(),
): Promise<NoaaRun | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of model.runHours) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      let complete = true;
      for (const url of model.completionUrls(date, hour)) {
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

export interface BuildProfilesOptions {
  maxSteps?: number;
  wire?: NoaaWire;
  generatedAt?: () => string;
}

export interface BuildProfilesResult {
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
  profiles: ArchivableProfile[];
}

export async function buildProfiles(
  model: NoaaModel,
  run: NoaaRun,
  referenceTime: string,
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildProfilesOptions = {},
): Promise<BuildProfilesResult> {
  const wire = options.wire ?? liveWire({ stats });
  const forecastSlots = model.forecastHours
    .map((hour) => ({ forecastHour: hour, validAt: validTime(referenceTime, hour) }))
    .slice(0, options.maxSteps);
  const firstForecastHour = forecastSlots[0]!.forecastHour;
  const slotHours = forecastSlots.map((slot) => slot.forecastHour);

  const tokens = [
    ...new Set([
      model.surfaceToken,
      model.pressureToken,
      ...(model.cloudLayerToken !== undefined ? [model.cloudLayerToken] : []),
    ]),
  ];
  const recordStores = new Map(tokens.map((token) => [token, new Map<number, IdxRecord[]>()]));
  const indexHoursFor = (token: string): number[] =>
    token === model.surfaceToken
      ? [...new Set([...slotHours, ...(model.extraIndexHours?.(slotHours) ?? [])])].sort(
          (a, b) => a - b,
        )
      : slotHours;

  const indexTask = (token: string, forecastHour: number) => async (): Promise<void> => {
    const url = model.fileUrl(token, run.date, run.hour, forecastHour) + ".idx";
    recordStores.get(token)!.set(forecastHour, await wire.fetchIndex(url));
  };

  await runConcurrent(
    tokens.flatMap((token) => indexHoursFor(token).map((hour) => indexTask(token, hour))),
    model.fetchConcurrency,
  );

  const recordValues = async (
    token: string,
    forecastHour: number,
    variable: string,
    level: string,
    forecast?: string,
    qualifier?: string,
  ): Promise<Record<string, GridPointValue>> => {
    const record = findRecord(
      recordStores.get(token)!.get(forecastHour)!,
      variable,
      level,
      forecast ?? `${forecastHour} hour fcst`,
      qualifier,
    );
    const data = await wire.fetchRecord(
      model.fileUrl(token, run.date, run.hour, forecastHour),
      record,
    );
    return wire.sampleSites(data, sites, model.maxNearestKm);
  };

  const windValues = async (
    token: string,
    forecastHour: number,
    level: string,
  ): Promise<Record<string, [number, number] | null>> => {
    let u: Record<string, GridPointValue>;
    let v: Record<string, GridPointValue>;
    if (model.pairSpanUv) {
      const forecast = `${forecastHour} hour fcst`;
      const records = recordStores.get(token)!.get(forecastHour)!;
      const uRecord = findRecord(records, "UGRD", level, forecast);
      const vRecord = findRecord(records, "VGRD", level, forecast);
      const url = model.fileUrl(token, run.date, run.hour, forecastHour);
      if (uRecord.offset === vRecord.offset) {
        const data = await wire.fetchRecord(url, pairSpan(uRecord, vRecord));
        [u, v] = wire.sampleSitesUv!(data, sites, model.maxNearestKm);
      } else {
        u = wire.sampleSites(await wire.fetchRecord(url, uRecord), sites, model.maxNearestKm);
        v = wire.sampleSites(await wire.fetchRecord(url, vRecord), sites, model.maxNearestKm);
      }
    } else {
      u = await recordValues(token, forecastHour, "UGRD", level);
      v = await recordValues(token, forecastHour, "VGRD", level);
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
      let uEarth = uSample.value;
      let vEarth = vSample.value;
      if (model.lambert !== undefined) {
        [uEarth, vEarth] = lambertEarthWind(
          uSample.value,
          vSample.value,
          uSample.longitude,
          model.lambert.orientationDeg,
          model.lambert.cone,
        );
      }
      winds[slug] = windFromUv(uEarth, vEarth);
    }
    return winds;
  };

  const terrain = await recordValues(model.surfaceToken, firstForecastHour, "HGT", "surface");
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
    (hourIndex: number, fieldName: string, variable: string, level: string, convert: Convert) =>
    async (): Promise<void> => {
      const values = await recordValues(
        model.surfaceToken,
        forecastSlots[hourIndex]!.forecastHour,
        variable,
        level,
      );
      for (const site of sites) {
        const hour = hoursBySite[site.slug]![hourIndex]!;
        hour[fieldName] = convert(requiredValue("NOAA", values[site.slug]!.value, fieldName, site));
      }
    };

  const temperatureTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const temperature = await recordValues(
      model.surfaceToken,
      forecastHour,
      "TMP",
      "2 m above ground",
    );
    const dewPoint = await recordValues(
      model.surfaceToken,
      forecastHour,
      "DPT",
      "2 m above ground",
    );
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
    const winds = await windValues(
      model.surfaceToken,
      forecastSlots[hourIndex]!.forecastHour,
      "10 m above ground",
    );
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

  const optionalSurfaceTask =
    (hourIndex: number, fieldName: string, variable: string, level: string, token: string) =>
    async (): Promise<void> => {
      const forecastHour = forecastSlots[hourIndex]!.forecastHour;
      let values: Record<string, GridPointValue>;
      try {
        values = await recordValues(token, forecastHour, variable, level);
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

  const smokeTask = (hourIndex: number) => async (): Promise<void> => {
    const smokeFields = model.smokeFields!;
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const valuesByField: Array<
      [fieldName: string, values: Record<string, GridPointValue>, convert: Convert]
    > = [];
    try {
      for (const [fieldName, [variable, level, qualifier, convert]] of Object.entries(
        smokeFields,
      )) {
        valuesByField.push([
          fieldName,
          await recordValues(
            model.surfaceToken,
            forecastHour,
            variable,
            level,
            undefined,
            qualifier,
          ),
          convert,
        ]);
      }
    } catch (error) {
      if (isMissingRecord(error)) {
        return; // all-or-nothing block: absence stays out of the document
      }
      throw error;
    }
    for (const site of sites) {
      const slug = site.slug;
      const block: Record<string, number> = {};
      for (const [fieldName, values, convert] of valuesByField) {
        const value = values[slug]!.value;
        if (value === null) {
          break;
        }
        block[fieldName] = convert(value);
      }
      if (Object.keys(block).length === Object.keys(smokeFields).length) {
        hoursBySite[slug]![hourIndex]!["smoke"] = block;
      }
    }
  };

  const pressureTask = (hourIndex: number, pressureHpa: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const level = `${pressureHpa} mb`;
    const token = model.pressureToken;
    const temperature = await recordValues(token, forecastHour, "TMP", level);
    const moisture = await recordValues(
      token,
      forecastHour,
      model.levelDewPoint ? "DPT" : "RH",
      level,
    );
    const height = await recordValues(token, forecastHour, "HGT", level);
    const winds = await windValues(token, forecastHour, level);
    let cloud: Record<string, GridPointValue> | null = null;
    if (model.levelCloudFraction) {
      try {
        cloud = await recordValues(token, forecastHour, "TCDC", level);
      } catch (error) {
        if (!isMissingRecord(error)) {
          throw error;
        }
      }
    }
    let verticalVelocity: Record<string, GridPointValue> | null = null;
    if (model.verticalVelocity.levels.includes(pressureHpa)) {
      try {
        verticalVelocity = await recordValues(
          token,
          forecastHour,
          model.verticalVelocity.variable,
          level,
        );
      } catch (error) {
        if (!isMissingRecord(error)) {
          throw error; // optional field: absence stays out of the document
        }
      }
    }
    for (const site of sites) {
      const slug = site.slug;
      const t = temperature[slug]!.value;
      const m = moisture[slug]!.value;
      const h = height[slug]!.value;
      const wind = winds[slug];
      if (t === null || m === null || h === null || wind === null || wind === undefined) {
        continue;
      }
      const entry: BuilderLevel = {
        pressureHpa,
        heightM: h,
        temperatureC: t - KELVIN,
        dewPointDepressionC: model.levelDewPoint ? t - m : dewPointDepression(t - KELVIN, m),
        windDirectionDeg: wind[1],
        windSpeedMps: wind[0],
      };
      if (cloud !== null && cloud[slug]!.value !== null) {
        entry["cloudFractionPercent"] = cloud[slug]!.value!;
      }
      const w = verticalVelocity?.[slug]!.value;
      if (w !== null && w !== undefined) {
        entry["verticalVelocityPaS"] =
          model.verticalVelocity.toOmega === undefined
            ? w
            : model.verticalVelocity.toOmega(w, pressureHpa, t);
      }
      hoursBySite[slug]![hourIndex]!.levels[pressureHpa] = entry;
    }
  };

  const hourTools = (hourIndex: number): NoaaHourTools => ({
    forecastHour: forecastSlots[hourIndex]!.forecastHour,
    runHour: run.hour,
    sites,
    values: (fileHour, variable, level, forecast) =>
      recordValues(model.surfaceToken, fileHour, variable, level, forecast),
    set: (siteSlug, fieldName, value) => {
      hoursBySite[siteSlug]![hourIndex]![fieldName] = value;
    },
  });

  const cloudLayerToken = model.cloudLayerToken ?? model.surfaceToken;

  const tasksForHour = (hourIndex: number): Array<() => Promise<void>> => [
    temperatureTask(hourIndex),
    surfaceWindTask(hourIndex),
    ...model.hourTasks.map((task) => () => task(hourTools(hourIndex))),
    ...Object.entries(model.surfaceFields).map(([fieldName, [variable, level, convert]]) =>
      surfaceTask(hourIndex, fieldName, variable, level, convert),
    ),
    ...Object.entries(model.optionalSurfaceFields).map(([fieldName, [variable, level]]) =>
      optionalSurfaceTask(hourIndex, fieldName, variable, level, model.surfaceToken),
    ),
    ...Object.entries(model.cloudLayerFields ?? {}).map(([fieldName, [variable, level]]) =>
      optionalSurfaceTask(hourIndex, fieldName, variable, level, cloudLayerToken),
    ),
    ...(model.smokeFields !== undefined ? [smokeTask(hourIndex)] : []),
    ...model.pressureLevels.map((level) => pressureTask(hourIndex, level)),
  ];

  await runConcurrent(
    forecastSlots.flatMap((_slot, index) => tasksForHour(index)),
    model.fetchConcurrency,
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
        model.slug,
        model.semantics,
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

export interface NoaaBuildOptions {
  sitesPath: string;
  history?: boolean;
  outputRoot?: string;
  maxSteps?: number;
  referenceTime?: string;
  dataset?: DatasetOptions;
  wire?: NoaaWire;
  fetch?: TransportFetch;
  log?: (line: string) => void;
  now?: () => Date;
  generatedAt?: () => string;
}

export async function buildNoaa(model: NoaaModel, options: NoaaBuildOptions): Promise<boolean> {
  let run: NoaaRun;
  return publishRun(
    {
      slug: model.slug,
      label: model.label,
      publishedNoun: `${model.label} profiles`,
      resolveRun: async () => {
        if (options.referenceTime !== undefined) {
          run = parseCycleStamp(options.referenceTime, model.runHours, model.cycleName);
          return options.referenceTime;
        }
        const probed = await latestCompleteRun(model, options.fetch, options.now);
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
        const result = await buildProfiles(model, run, referenceTime, sites, stats, buildOptions);
        return { ...result, documents: result.profiles };
      },
    },
    options,
  );
}

// ---------------------------------------------------------------------------
// HRRR
// ---------------------------------------------------------------------------

const HRRR_BASE_URL = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com";
const HRRR_PRESSURE_LEVELS = [925, 900, 875, 850, 800, 750, 700, 650, 600] as const;

function hrrrFileUrl(_token: string, date: string, runHour: string, forecastHour: number): string {
  const step = String(forecastHour).padStart(2, "0");
  return `${HRRR_BASE_URL}/hrrr.${date}/conus/hrrr.t${runHour}z.wrfprsf${step}.grib2`;
}

export const HRRR: NoaaModel = {
  slug: "hrrr-conus",
  label: "HRRR",
  cycleName: "HRRR",
  runHours: ["18", "12", "06", "00"], // Only the synoptic cycles run to 48 h.
  forecastHours: range(1, 49),
  fetchConcurrency: 10,
  maxNearestKm: 5.0,
  semantics: { gust: "instant", precipitation: "instantRate", smoke: "radiativelyCoupled" },
  pressureLevels: HRRR_PRESSURE_LEVELS,
  surfaceToken: "",
  pressureToken: "",
  fileUrl: hrrrFileUrl,
  completionUrls: (date, runHour) => [hrrrFileUrl("", date, runHour, 48) + ".idx"],
  surfaceFields: {
    cloudCoverPercent: ["TCDC", "entire atmosphere", (v) => v],
    latentHeatFluxWm2: ["LHTFL", "surface", (v) => v],
    precipitationMm: ["PRATE", "surface", (v) => v * 3600],
    seaLevelPressureHpa: ["MSLMA", "mean sea level", (v) => v / 100.0],
    sensibleHeatFluxWm2: ["SHTFL", "surface", (v) => v],
  },
  optionalSurfaceFields: {
    windGustMps: ["GUST", "surface"],
    capeJkg: ["CAPE", "surface"],
    cinJkg: ["CIN", "surface"],
    pblHeightM: ["HPBL", "surface"],
    lowCloudPercent: ["LCDC", "low cloud layer"],
    midCloudPercent: ["MCDC", "middle cloud layer"],
    highCloudPercent: ["HCDC", "high cloud layer"],
  },
  smokeFields: {
    surfaceUgm3: ["MASSDEN", "8 m above ground", undefined, (v) => v * 1e9],
    columnMgm2: [
      "COLMD",
      "entire atmosphere (considered as a single layer)",
      undefined,
      (v) => v * 1e6,
    ],
    aot: ["AOTK", "entire atmosphere (considered as a single layer)", undefined, (v) => v],
  },
  levelDewPoint: true,
  verticalVelocity: { variable: "VVEL", levels: HRRR_PRESSURE_LEVELS },
  lambert: { orientationDeg: 262.5, cone: lambertConeConstant(38.5, 38.5) },
  hourTasks: [],
};

// ---------------------------------------------------------------------------
// GFS
// ---------------------------------------------------------------------------

const GFS_BASE_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
const GFS_STEP_HOURS = 3;
const GFS_PRESSURE_LEVELS = [925, 900, 850, 800, 750, 700, 650, 600] as const;

function gfsFileUrl(_token: string, date: string, runHour: string, forecastHour: number): string {
  const step = String(forecastHour).padStart(3, "0");
  return `${GFS_BASE_URL}/gfs.${date}/${runHour}/atmos/gfs.t${runHour}z.pgrb2.0p25.f${step}`;
}

export function windowStart(forecastHour: number): number {
  return Math.floor((forecastHour - GFS_STEP_HOURS) / 6) * 6;
}

export function deaveraged(current: number, companion: number): number {
  return 2 * current - companion;
}

export function differenced(current: number, companion: number): number {
  return current - companion;
}

async function gfsWindowedValues(
  tools: NoaaHourTools,
  variable: string,
  kind: string,
  fileHour: number,
): Promise<Record<string, number | null>> {
  const forecast = `${windowStart(fileHour)}-${fileHour} hour ${kind} fcst`;
  const samples = await tools.values(fileHour, variable, "surface", forecast);
  return Object.fromEntries(Object.entries(samples).map(([slug, sample]) => [slug, sample.value]));
}

async function gfsThreeHourValues(
  tools: NoaaHourTools,
  variable: string,
  kind: string,
  targetHour: number,
): Promise<Record<string, number | null>> {
  const current = await gfsWindowedValues(tools, variable, kind, targetHour);
  if (windowStart(targetHour) === targetHour - GFS_STEP_HOURS) {
    return current;
  }
  const companion = await gfsWindowedValues(tools, variable, kind, targetHour - GFS_STEP_HOURS);
  const recover = kind === "ave" ? deaveraged : differenced;
  return Object.fromEntries(
    Object.keys(current).map((slug) => [
      slug,
      current[slug] === null || companion[slug] === null
        ? null
        : recover(current[slug]!, companion[slug]!),
    ]),
  );
}

export const GFS: NoaaModel = {
  slug: "gfs",
  label: "GFS",
  cycleName: "GFS",
  runHours: ["18", "12", "06", "00"],
  forecastHours: range(GFS_STEP_HOURS, 384 + GFS_STEP_HOURS, GFS_STEP_HOURS),
  fetchConcurrency: 10,
  maxNearestKm: 30.0,
  semantics: { gust: "instant", precipitation: "windowMeanRate" },
  pressureLevels: GFS_PRESSURE_LEVELS,
  surfaceToken: "",
  pressureToken: "",
  fileUrl: gfsFileUrl,
  completionUrls: (date, runHour) => [gfsFileUrl("", date, runHour, 384) + ".idx"],
  extraIndexHours: (slotHours) =>
    slotHours
      .filter((hour) => windowStart(hour) !== hour - GFS_STEP_HOURS)
      .map((hour) => hour - GFS_STEP_HOURS),
  surfaceFields: {
    cloudCoverPercent: ["TCDC", "entire atmosphere", (v) => v],
    seaLevelPressureHpa: ["PRMSL", "mean sea level", (v) => v / 100.0],
  },
  optionalSurfaceFields: {
    windGustMps: ["GUST", "surface"],
    capeJkg: ["CAPE", "surface"],
    cinJkg: ["CIN", "surface"],
    pblHeightM: ["HPBL", "surface"],
    lowCloudPercent: ["LCDC", "low cloud layer"],
    midCloudPercent: ["MCDC", "middle cloud layer"],
    highCloudPercent: ["HCDC", "high cloud layer"],
  },
  levelDewPoint: false,
  levelCloudFraction: true,
  verticalVelocity: { variable: "VVEL", levels: GFS_PRESSURE_LEVELS },
  hourTasks: [
    // The fluxes publish as window averages; recover each 3 h mean from
    // the 6 h window's companion file when the window spans two steps.
    async (tools) => {
      for (const [fieldName, variable] of [
        ["latentHeatFluxWm2", "LHTFL"],
        ["sensibleHeatFluxWm2", "SHTFL"],
      ] as const) {
        const means = await gfsThreeHourValues(tools, variable, "ave", tools.forecastHour);
        for (const site of tools.sites) {
          tools.set(site.slug, fieldName, requiredValue("NOAA", means[site.slug], fieldName, site));
        }
      }
    },
    // Precipitation publishes as window accumulations on the same cadence.
    async (tools) => {
      const accumulations = await gfsThreeHourValues(tools, "APCP", "acc", tools.forecastHour);
      for (const site of tools.sites) {
        tools.set(
          site.slug,
          "precipitationMm",
          requiredValue("NOAA", accumulations[site.slug], "precipitationMm", site) / 3.0,
        );
      }
    },
  ],
};

// ---------------------------------------------------------------------------
// NAM — two products off one table
// ---------------------------------------------------------------------------

const NAM_BASE_URL = "https://noaa-nam-pds.s3.amazonaws.com";
const NAM_PRESSURE_LEVELS = [925, 900, 875, 850, 800, 750, 700, 650, 600] as const;

export interface NamModel extends NoaaModel {
  hourlyThrough: number; // last hour of the hourly cadence; 3-hourly beyond
  bucketResetHours: number; // APCP bucket length on the 00/12Z cycles
  offCycleBucketResetHours: number; // APCP bucket length on 06/18Z
}

function namFileUrl(token: string, date: string, runHour: string, forecastHour: number): string {
  const step = String(forecastHour).padStart(2, "0");
  return `${NAM_BASE_URL}/nam.${date}/nam.t${runHour}z.${token}${step}.tm00.grib2`;
}

export function precipFetches(
  product: NamModel,
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

// NAM buckets accumulate from a per-cycle reset, so a step's millimetres
// are the bucket minus the previous step's bucket within the same window.
function namPrecipitationTask(product: NamModel): NoaaHourTask {
  return async (tools) => {
    const [fetches, windowHours] = precipFetches(product, tools.runHour, tools.forecastHour);
    const samples: Array<Record<string, GridPointValue>> = [];
    for (const [fileHour, forecast] of fetches) {
      samples.push(await tools.values(fileHour, "APCP", "surface", forecast));
    }
    for (const site of tools.sites) {
      const slug = site.slug;
      let millimetres = requiredValue("NOAA", samples[0]![slug]!.value, "precipitationMm", site);
      if (samples.length === 2) {
        millimetres -= requiredValue("NOAA", samples[1]![slug]!.value, "precipitationMm", site);
      }
      tools.set(slug, "precipitationMm", millimetres / windowHours);
    }
  };
}

// NAM publishes PRMSL directly; the PRES:surface record beside it is
// station pressure, not the contract's MSL pressure.
const NAM_SURFACE_FIELDS: Record<string, [string, string, Convert]> = {
  cloudCoverPercent: ["TCDC", "entire atmosphere (considered as a single layer)", (v) => v],
  latentHeatFluxWm2: ["LHTFL", "surface", (v) => v],
  seaLevelPressureHpa: ["PRMSL", "mean sea level", (v) => v / 100.0],
  sensibleHeatFluxWm2: ["SHTFL", "surface", (v) => v],
};
const NAM_OPTIONAL_SURFACE_FIELDS: Record<string, [string, string]> = {
  windGustMps: ["GUST", "surface"],
  capeJkg: ["CAPE", "surface"],
  cinJkg: ["CIN", "surface"],
  pblHeightM: ["HPBL", "surface"],
};
export const CLOUD_LAYER_FIELDS: Record<string, [string, string]> = {
  lowCloudPercent: ["LCDC", "low cloud layer"],
  midCloudPercent: ["MCDC", "middle cloud layer"],
  highCloudPercent: ["HCDC", "high cloud layer"],
};

function namProduct(
  facts: Pick<
    NamModel,
    "slug" | "label" | "forecastHours" | "hourlyThrough" | "bucketResetHours"
  > & {
    fileToken: string;
    offCycleBucketResetHours: number;
    lambertOrientationDeg: number; // LoV
    lambertCone: number; // sin(Latin1); one standard parallel on both grids
    maxNearestKm: number;
    cloudFileToken: string | null; // layered cloud companion file, if separate
  },
): NamModel {
  const product: NamModel = {
    slug: facts.slug,
    label: facts.label,
    cycleName: "NAM",
    runHours: ["18", "12", "06", "00"],
    forecastHours: facts.forecastHours,
    // noaa-nam-pds serves ranged GETs at ~1 s per request, so connections,
    // not bandwidth, pace the nest — this gate runs wider than the other
    // NOAA builders' 10 for that reason.
    fetchConcurrency: 14,
    maxNearestKm: facts.maxNearestKm,
    semantics: { gust: "instant", precipitation: "windowMeanRate" },
    pressureLevels: NAM_PRESSURE_LEVELS,
    surfaceToken: facts.fileToken,
    pressureToken: facts.fileToken,
    ...(facts.cloudFileToken !== null ? { cloudLayerToken: facts.cloudFileToken } : {}),
    fileUrl: namFileUrl,
    completionUrls: (date, runHour) => {
      const last = facts.forecastHours[facts.forecastHours.length - 1]!;
      const urls = [namFileUrl(facts.fileToken, date, runHour, last) + ".idx"];
      if (facts.cloudFileToken !== null) {
        urls.push(namFileUrl(facts.cloudFileToken, date, runHour, last) + ".idx");
      }
      return urls;
    },
    surfaceFields: NAM_SURFACE_FIELDS,
    optionalSurfaceFields: NAM_OPTIONAL_SURFACE_FIELDS,
    cloudLayerFields: CLOUD_LAYER_FIELDS,
    levelDewPoint: false,
    verticalVelocity: { variable: "VVEL", levels: NAM_PRESSURE_LEVELS },
    lambert: { orientationDeg: facts.lambertOrientationDeg, cone: facts.lambertCone },
    pairSpanUv: true,
    hourTasks: [],
    hourlyThrough: facts.hourlyThrough,
    bucketResetHours: facts.bucketResetHours,
    offCycleBucketResetHours: facts.offCycleBucketResetHours,
  };
  return { ...product, hourTasks: [namPrecipitationTask(product)] };
}

export const NAM_PRODUCTS: Record<string, NamModel> = {
  "nam-conus-nest": namProduct({
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
  }),
  nam: namProduct({
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
  }),
};

// ---------------------------------------------------------------------------
// RRFS
// ---------------------------------------------------------------------------

// rrfs_public/ is the bucket prefix NOAA GSL's pipelines name as the v1.0
// destination, with the .idx sidecars the NOMADS trees lack.
// METEO_RRFS_BASE re-points the builder without a release.
export const DEFAULT_BASE_URL = "https://noaa-rrfs-pds.s3.amazonaws.com/rrfs_public";
export function baseUrl(): string {
  return (process.env["METEO_RRFS_BASE"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

const RRFS_PRESSURE_LEVELS = [925, 900, 875, 850, 800, 750, 700, 650, 600] as const;

// RRFS-SD speciates its aerosols where HRRR carried one unspeciated smoke
// tracer, so the same variable name appears once per species and only the
// idx qualifier separates smoke from dust — selecting MASSDEN by name alone
// returns an arbitrary species. The smoke block reads the biomass-burning
// tracer (particulate organic matter, PM2.5); AOTK is the model's one
// column optical thickness, published unqualified over all species.
export const SMOKE_QUALIFIER = "aerosol=Particulate organic matter dry:aerosol_size <2.5e-06";

const DRY_AIR_GAS_CONSTANT_J_KG_K = 287.05;
const STANDARD_GRAVITY_M_S2 = 9.80665;

/**
 * RRFS publishes geometric vertical velocity (DZDT, m/s), not omega. The
 * hydrostatic conversion ω ≈ −ρgw with dry-air density ρ = p/(R_d·T) turns it
 * into the contract's pressure tendency; the catalogue declares the
 * provenance as `verticalVelocity: "fromGeometricW"`.
 */
export function omegaFromGeometricW(
  wMps: number,
  pressureHpa: number,
  temperatureK: number,
): number {
  const densityKgM3 = (pressureHpa * 100.0) / (DRY_AIR_GAS_CONSTANT_J_KG_K * temperatureK);
  return -densityKgM3 * STANDARD_GRAVITY_M_S2 * wMps;
}

function rrfsFileUrl(token: string, date: string, runHour: string, forecastHour: number): string {
  const step = String(forecastHour).padStart(3, "0");
  return `${baseUrl()}/rrfs.${date}/${runHour}/rrfs.t${runHour}z.${token}.3km.f${step}.conus.grib2`;
}

export const RRFS: NoaaModel = {
  slug: "rrfs",
  label: "RRFS",
  cycleName: "RRFS",
  // Only the synoptic cycles publish the isobaric prslev files; the other
  // hourly cycles carry sub-hourly 2dfld output only, which cannot build a
  // profile.
  runHours: ["18", "12", "06", "00"],
  forecastHours: range(1, 85),
  fetchConcurrency: 10,
  maxNearestKm: 5.0,
  semantics: { gust: "instant", precipitation: "windowMeanRate", smoke: "radiativelyCoupled" },
  pressureLevels: RRFS_PRESSURE_LEVELS,
  // Every surface and science field lives in the 2dfld companion; the prslev
  // file carries the isobaric column. MSLET is RRFS's one MSL pressure record
  // (HRRR publishes MSLMA, NAM PRMSL). The un-suffixed SHTFL/LHTFL records are
  // instantaneous; the hour-average twins are distinguished by the idx window
  // token and skipped.
  surfaceToken: "2dfld",
  pressureToken: "prslev",
  fileUrl: rrfsFileUrl,
  completionUrls: (date, runHour) => [
    rrfsFileUrl("prslev", date, runHour, 84) + ".idx",
    rrfsFileUrl("2dfld", date, runHour, 84) + ".idx",
  ],
  surfaceFields: {
    cloudCoverPercent: ["TCDC", "entire atmosphere (considered as a single layer)", (v) => v],
    latentHeatFluxWm2: ["LHTFL", "surface", (v) => v],
    seaLevelPressureHpa: ["MSLET", "mean sea level", (v) => v / 100.0],
    sensibleHeatFluxWm2: ["SHTFL", "surface", (v) => v],
  },
  optionalSurfaceFields: {
    windGustMps: ["GUST", "surface"],
    capeJkg: ["CAPE", "surface"],
    cinJkg: ["CIN", "surface"],
    pblHeightM: ["HPBL", "surface"],
    lowCloudPercent: ["LCDC", "low cloud layer"],
    midCloudPercent: ["MCDC", "middle cloud layer"],
    highCloudPercent: ["HCDC", "high cloud layer"],
  },
  smokeFields: {
    surfaceUgm3: ["MASSDEN", "8 m above ground", SMOKE_QUALIFIER, (v) => v * 1e9],
    columnMgm2: [
      "COLMD",
      "entire atmosphere (considered as a single layer)",
      SMOKE_QUALIFIER,
      (v) => v * 1e6,
    ],
    aot: ["AOTK", "entire atmosphere (considered as a single layer)", "", (v) => v],
  },
  levelDewPoint: true,
  verticalVelocity: {
    variable: "DZDT",
    levels: RRFS_PRESSURE_LEVELS,
    toOmega: omegaFromGeometricW,
  },
  // The CONUS cutout is exactly HRRR's Lambert conformal grid.
  lambert: { orientationDeg: 262.5, cone: lambertConeConstant(38.5, 38.5) },
  hourTasks: [
    // APCP publishes a fixed one-hour bucket at every step ((h−1)–h acc)
    // beside the run total; mm over one hour is mm/h directly.
    async (tools) => {
      const values = await tools.values(
        tools.forecastHour,
        "APCP",
        "surface",
        `${tools.forecastHour - 1}-${tools.forecastHour} hour acc fcst`,
      );
      for (const site of tools.sites) {
        tools.set(
          site.slug,
          "precipitationMm",
          requiredValue("NOAA", values[site.slug]!.value, "precipitationMm", site),
        );
      }
    },
  ],
};
