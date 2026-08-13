import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MissingRecordError,
  findRecord,
  lambertConeConstant,
  lambertEarthWind,
  type IdxRecord,
} from "@azohra/meteo.grib";
import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";
import { publishedHistory, publishedReferenceTime, type DatasetOptions } from "../dataset.js";
import { SCHEMA_VERSION, deriveSiteForecast, type SourceHour } from "../derive.js";
import { appendHistory, type ArchivableProfile } from "../history.js";
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

export const SLUG = "rrfs";
// The prototype trees froze when the pre-implementation parallel phase began
// (2026-08-11); the registry commits that the parallel and operational data
// land on this same bucket, and NOAA GSL's own pipelines name rrfs_public/
// as the v1.0 destination (with .idx sidecars the NOMADS para tree lacks).
// METEO_RRFS_BASE re-points the builder without a release if that moves.
export const DEFAULT_BASE_URL = "https://noaa-rrfs-pds.s3.amazonaws.com/rrfs_public";
export function baseUrl(): string {
  return (process.env["METEO_RRFS_BASE"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}
// Only the synoptic cycles publish the isobaric prslev files; the other
// hourly cycles carry sub-hourly 2dfld output only, which cannot build a
// profile.
export const RUN_HOURS = ["18", "12", "06", "00"] as const;
export const FORECAST_HOURS = 84;
export const FETCH_CONCURRENCY = 10;
export const MAX_NEAREST_KM = 5.0;

export type RrfsFileToken = "prslev" | "2dfld";

// Every surface and science field lives in the 2dfld companion; the prslev
// file carries the isobaric column. MSLET is RRFS's one MSL pressure record
// (HRRR publishes MSLMA, NAM PRMSL). The un-suffixed SHTFL/LHTFL records are
// instantaneous; the hour-average twins are distinguished by the idx window
// token and skipped.
export const SURFACE_FIELDS: Record<
  string,
  [variable: string, level: string, convert: (value: number) => number]
> = {
  cloudCoverPercent: ["TCDC", "entire atmosphere (considered as a single layer)", (v) => v],
  latentHeatFluxWm2: ["LHTFL", "surface", (v) => v],
  seaLevelPressureHpa: ["MSLET", "mean sea level", (v) => v / 100.0],
  sensibleHeatFluxWm2: ["SHTFL", "surface", (v) => v],
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
// RRFS-SD speciates its aerosols where HRRR carried one unspeciated smoke
// tracer, so the same variable name appears once per species and only the
// idx qualifier separates smoke from dust — selecting MASSDEN by name alone
// returns an arbitrary species. The smoke block reads the biomass-burning
// tracer (particulate organic matter, PM2.5); AOTK is the model's one
// column optical thickness, published unqualified over all species.
export const SMOKE_QUALIFIER = "aerosol=Particulate organic matter dry:aerosol_size <2.5e-06";
export const SMOKE_FIELDS: Record<
  string,
  [variable: string, level: string, qualifier: string, convert: (value: number) => number]
> = {
  surfaceUgm3: ["MASSDEN", "8 m above ground", SMOKE_QUALIFIER, (v) => v * 1e9],
  columnMgm2: [
    "COLMD",
    "entire atmosphere (considered as a single layer)",
    SMOKE_QUALIFIER,
    (v) => v * 1e6,
  ],
  aot: ["AOTK", "entire atmosphere (considered as a single layer)", "", (v) => v],
};
export const PRESSURE_LEVELS = [925, 900, 875, 850, 800, 750, 700, 650, 600] as const;
export const VERTICAL_VELOCITY_LEVELS = PRESSURE_LEVELS;

export const SEMANTICS: ForecastSemantics = {
  gust: "instant",
  precipitation: "windowMeanRate",
  smoke: "radiativelyCoupled",
};

// The CONUS cutout is exactly HRRR's Lambert conformal grid.
export const LAMBERT_CONE = lambertConeConstant(38.5, 38.5);
export const LAMBERT_ORIENTATION_DEG = 262.5;

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

export interface RrfsRun {
  date: string;
  hour: string;
}

export interface RrfsWire {
  fetchIndex(url: string): Promise<IdxRecord[]>;
  fetchRecord(url: string, record: IdxRecord): Promise<unknown>;
  sampleSites(
    message: unknown,
    sites: readonly SampleSite[],
    maxDistanceKm: number,
  ): Record<string, GridPointValue>;
}

function liveWire(options: NoaaOptions): RrfsWire {
  return {
    fetchIndex: (url) => fetchIndex(url, options),
    fetchRecord: (url, record) => fetchRecord(url, record, options),
    sampleSites: (message, sites, maxDistanceKm) =>
      sampleSites(message as Uint8Array, sites, maxDistanceKm),
  };
}

export function fileUrl(
  fileToken: RrfsFileToken,
  date: string,
  runHour: string,
  forecastHour: number,
): string {
  const step = String(forecastHour).padStart(3, "0");
  return `${baseUrl()}/rrfs.${date}/${runHour}/rrfs.t${runHour}z.${fileToken}.3km.f${step}.conus.grib2`;
}

export function completionUrls(date: string, runHour: string): string[] {
  return [
    fileUrl("prslev", date, runHour, FORECAST_HOURS) + ".idx",
    fileUrl("2dfld", date, runHour, FORECAST_HOURS) + ".idx",
  ];
}

export async function latestCompleteRun(
  fetchImpl: TransportFetch = globalThis.fetch,
  now: () => Date = () => new Date(),
): Promise<RrfsRun | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of RUN_HOURS) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      let complete = true;
      for (const url of completionUrls(date, hour)) {
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
  wire?: RrfsWire;
  generatedAt?: () => string;
}

export interface BuildProfilesResult {
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
  profiles: ArchivableProfile[];
}

export async function buildProfiles(
  run: RrfsRun,
  referenceTime: string,
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildProfilesOptions = {},
): Promise<BuildProfilesResult> {
  const wire = options.wire ?? liveWire({ stats });
  const cap = options.maxSteps ?? envMaxSteps();
  let forecastSlots = [];
  for (let hour = 1; hour <= FORECAST_HOURS; hour += 1) {
    forecastSlots.push({ forecastHour: hour, validAt: validTime(referenceTime, hour) });
  }
  forecastSlots = forecastSlots.slice(0, cap);
  const firstForecastHour = forecastSlots[0]!.forecastHour;

  const prslevRecordsByHour = new Map<number, IdxRecord[]>();
  const surfaceRecordsByHour = new Map<number, IdxRecord[]>();
  const recordStores: Record<RrfsFileToken, Map<number, IdxRecord[]>> = {
    prslev: prslevRecordsByHour,
    "2dfld": surfaceRecordsByHour,
  };

  const indexTask = (forecastHour: number, fileToken: RrfsFileToken) => async (): Promise<void> => {
    const url = fileUrl(fileToken, run.date, run.hour, forecastHour) + ".idx";
    recordStores[fileToken].set(forecastHour, await wire.fetchIndex(url));
  };

  await runConcurrent(
    forecastSlots.flatMap((slot) => [
      indexTask(slot.forecastHour, "prslev"),
      indexTask(slot.forecastHour, "2dfld"),
    ]),
    FETCH_CONCURRENCY,
  );

  const recordValues = async (
    fileToken: RrfsFileToken,
    forecastHour: number,
    variable: string,
    level: string,
    forecast?: string,
    qualifier?: string,
  ): Promise<Record<string, GridPointValue>> => {
    const record = findRecord(
      recordStores[fileToken].get(forecastHour)!,
      variable,
      level,
      forecast ?? `${forecastHour} hour fcst`,
      qualifier,
    );
    const data = await wire.fetchRecord(
      fileUrl(fileToken, run.date, run.hour, forecastHour),
      record,
    );
    return wire.sampleSites(data, sites, MAX_NEAREST_KM);
  };

  const windValues = async (
    fileToken: RrfsFileToken,
    forecastHour: number,
    level: string,
  ): Promise<Record<string, [number, number] | null>> => {
    const u = await recordValues(fileToken, forecastHour, "UGRD", level);
    const v = await recordValues(fileToken, forecastHour, "VGRD", level);
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
        LAMBERT_ORIENTATION_DEG,
        LAMBERT_CONE,
      );
      winds[slug] = windFromUv(uEarth, vEarth);
    }
    return winds;
  };

  const terrain = await recordValues("2dfld", firstForecastHour, "HGT", "surface");
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
    (
      hourIndex: number,
      fieldName: string,
      variable: string,
      level: string,
      convert: (value: number) => number,
    ) =>
    async (): Promise<void> => {
      const values = await recordValues(
        "2dfld",
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
    const temperature = await recordValues("2dfld", forecastHour, "TMP", "2 m above ground");
    const dewPoint = await recordValues("2dfld", forecastHour, "DPT", "2 m above ground");
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
      "2dfld",
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

  // APCP publishes a fixed one-hour bucket at every step ((h−1)–h acc)
  // beside the run total; mm over one hour is mm/h directly.
  const precipitationTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const values = await recordValues(
      "2dfld",
      forecastHour,
      "APCP",
      "surface",
      `${forecastHour - 1}-${forecastHour} hour acc fcst`,
    );
    for (const site of sites) {
      const hour = hoursBySite[site.slug]![hourIndex]!;
      hour.precipitationMm = requiredValue(
        "NOAA",
        values[site.slug]!.value,
        "precipitationMm",
        site,
      );
    }
  };

  const optionalSurfaceTask =
    (hourIndex: number, fieldName: string, variable: string, level: string) =>
    async (): Promise<void> => {
      const forecastHour = forecastSlots[hourIndex]!.forecastHour;
      let values: Record<string, GridPointValue>;
      try {
        values = await recordValues("2dfld", forecastHour, variable, level);
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
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const valuesByField: Array<
      [
        fieldName: string,
        values: Record<string, GridPointValue>,
        convert: (value: number) => number,
      ]
    > = [];
    try {
      for (const [fieldName, [variable, level, qualifier, convert]] of Object.entries(
        SMOKE_FIELDS,
      )) {
        valuesByField.push([
          fieldName,
          await recordValues("2dfld", forecastHour, variable, level, undefined, qualifier),
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
      if (Object.keys(block).length === Object.keys(SMOKE_FIELDS).length) {
        hoursBySite[slug]![hourIndex]!["smoke"] = block;
      }
    }
  };

  const pressureTask = (hourIndex: number, pressureHpa: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const level = `${pressureHpa} mb`;
    const temperature = await recordValues("prslev", forecastHour, "TMP", level);
    const dewPoint = await recordValues("prslev", forecastHour, "DPT", level);
    const height = await recordValues("prslev", forecastHour, "HGT", level);
    const winds = await windValues("prslev", forecastHour, level);
    let geometricW: Record<string, GridPointValue> | null = null;
    try {
      geometricW = await recordValues("prslev", forecastHour, "DZDT", level);
    } catch (error) {
      if (!isMissingRecord(error)) {
        throw error; // optional field: absence stays out of the document
      }
    }
    for (const site of sites) {
      const slug = site.slug;
      const t = temperature[slug]!.value;
      const d = dewPoint[slug]!.value;
      const h = height[slug]!.value;
      const wind = winds[slug];
      if (t === null || d === null || h === null || wind === null || wind === undefined) {
        continue;
      }
      const entry: BuilderLevel = {
        pressureHpa,
        heightM: h,
        temperatureC: t - KELVIN,
        dewPointDepressionC: t - d,
        windDirectionDeg: wind[1],
        windSpeedMps: wind[0],
      };
      if (geometricW !== null && geometricW[slug]!.value !== null) {
        entry["verticalVelocityPaS"] = omegaFromGeometricW(
          geometricW[slug]!.value!,
          pressureHpa,
          t,
        );
      }
      hoursBySite[slug]![hourIndex]!.levels[pressureHpa] = entry;
    }
  };

  const tasksForHour = (hourIndex: number): Array<() => Promise<void>> => [
    temperatureTask(hourIndex),
    surfaceWindTask(hourIndex),
    precipitationTask(hourIndex),
    ...Object.entries(SURFACE_FIELDS).map(([fieldName, [variable, level, convert]]) =>
      surfaceTask(hourIndex, fieldName, variable, level, convert),
    ),
    ...Object.entries(OPTIONAL_SURFACE_FIELDS).map(([fieldName, [variable, level]]) =>
      optionalSurfaceTask(hourIndex, fieldName, variable, level),
    ),
    smokeTask(hourIndex),
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

export interface RrfsBuildOptions {
  sitesPath: string;
  history?: boolean;
  outputRoot?: string;
  maxSteps?: number;
  referenceTime?: string;
  dataset?: DatasetOptions;
  wire?: RrfsWire;
  fetch?: TransportFetch;
  log?: (line: string) => void;
  now?: () => Date;
  generatedAt?: () => string;
}

export async function buildRrfs(options: RrfsBuildOptions): Promise<boolean> {
  const log = options.log ?? ((line: string) => console.log(line));
  const sitesPath = options.sitesPath;
  const outputRoot = options.outputRoot ?? "data";
  const sites = parseSites(readFileSync(sitesPath, "utf-8"), sitesPath);

  let run: RrfsRun | null;
  let referenceTime: string;
  if (options.referenceTime !== undefined) {
    run = pinnedRun(options.referenceTime);
    referenceTime = options.referenceTime;
  } else {
    run = await latestCompleteRun(options.fetch, options.now);
    if (run === null) {
      log("No complete RRFS run is available.");
      return false;
    }
    const date = run.date;
    referenceTime = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${run.hour}:00:00Z`;
  }
  if ((await publishedReferenceTime(SLUG, options.dataset)) === referenceTime) {
    log(`RRFS run ${referenceTime} is already published.`);
    return false;
  }

  log(`Building RRFS ${referenceTime} for ${sites.length} sites…`);
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
    `Published ${result.profiles.length} RRFS profiles for ${referenceTime} ` +
      `(${stats.requests} requests, ${Math.floor(stats.responseBytes / (1024 * 1024))} MiB).`,
  );
  return true;
}

function pinnedRun(referenceTime: string): RrfsRun {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00Z$/.exec(referenceTime);
  if (match === null) {
    throw new Error(
      `referenceTime ${referenceTime} is not a RRFS cycle stamp (YYYY-MM-DDTHH:00:00Z)`,
    );
  }
  const hour = match[4]!;
  if (!(RUN_HOURS as readonly string[]).includes(hour)) {
    throw new Error(
      `referenceTime hour ${hour} is not a RRFS synoptic cycle (00/06/12/18) — ` +
        "the other hourly cycles publish no isobaric files",
    );
  }
  return { date: `${match[1]}${match[2]}${match[3]}`, hour };
}
