import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ECCODES_MISSING_VALUE,
  sampleFieldValuesAsync,
  earthWind,
  nearestGridpoint,
  parseFields,
  parseGrid,
  parseProduct,
  splitMessages,
  type DecodeJ2kAsync,
  type DecodeJ2kSampled,
  type GribField,
} from "@azohra/meteo.grib";
import {
  MANIFEST_SCHEMA_VERSION,
  SITE_FORECAST_SCHEMA_VERSION,
  type ForecastSemantics,
} from "@azohra/meteo.briefing/contract";
import { datamartBase, fetchBytes } from "../providers/datamart.js";
import { publishedHistory, publishedReferenceTime, type DatasetOptions } from "../dataset.js";
import { deriveSiteForecast, type SourceHour } from "../derive.js";
import { aggregateMemberProfiles, type MemberProfile } from "../ensemble.js";
import { appendHistory, type ArchivableProfile } from "../history.js";
import { dewPointDepression } from "../moisture.js";
import { windFromUv } from "../providers/noaa.js";
import { manifestStats, roundDocument, writeJson } from "../publish.js";
import { parseSites, type Site } from "../sites.js";
import {
  DownloadCounters,
  exists,
  keepAliveFetch,
  type TransportFetch,
} from "../providers/transport.js";
import {
  KELVIN,
  manifestInstant,
  maxSteps as envMaxSteps,
  memberRequiredValue,
  profileInstant,
  runConcurrent,
  validTime,
  withDewPointDepression,
} from "./common.js";
import { TASK_CONCURRENCY, concurrencyLimit, lazyJ2kPool } from "./eccc.js";

export const SLUG = "reps";

export const SEMANTICS: ForecastSemantics = { precipitation: "windowMeanRate" };

export const MEMBER_COUNT = 21;
export const PERTURBATION_NUMBERS: readonly number[] = Array.from(
  { length: MEMBER_COUNT },
  (_unused, member) => member,
);
export const RUN_HOURS = ["18", "12", "06", "00"] as const;
export const STEP_HOURS = 3;
export const LAST_FORECAST_HOUR = 72;
export const FORECAST_HOURS: readonly number[] = Array.from(
  { length: LAST_FORECAST_HOUR / STEP_HOURS },
  (_unused, index) => STEP_HOURS * (index + 1),
);

export const FETCH_CONCURRENCY = 5;

export const SURFACE_FIELDS: Record<
  string,
  [variableLevel: string, convert: (v: number) => number]
> = {
  cloudCoverPercent: ["TCDC_SFC", (v) => v],
  latentHeatFluxWm2: ["LHTFL_SFC", (v) => v],
  seaLevelPressureHpa: ["PRMSL_MSL", (v) => v / 100.0],
  relativeHumidityPercent: ["RH_AGL-2m", (v) => v],
  sensibleHeatFluxWm2: ["SHTFL_SFC", (v) => v],
  temperatureC: ["TMP_AGL-2m", (v) => v - KELVIN],
};
export const PRECIP_ACCUMULATION_VARIABLE = "APCP_SFC";
export const TERRAIN_VARIABLE = "HGT_SFC";
export const PRESSURE_FIELDS: Record<string, [variable: string, convert: (v: number) => number]> = {
  heightM: ["HGT", (v) => v],
  relativeHumidityPercent: ["RH", (v) => v],
  temperatureC: ["TMP", (v) => v - KELVIN],
};
export const PRESSURE_LEVELS = [1000, 925, 850, 700, 500] as const;

// Level token → pressureHpa; null marks the 10 m surface wind.
export const WIND_LEVEL_TOKENS: Record<string, number | null> = {
  "AGL-10m": null,
  ...Object.fromEntries(
    PRESSURE_LEVELS.map((level) => [`ISBL-${String(level).padStart(4, "0")}`, level]),
  ),
};

export const SURFACE_SCALARS = [
  "seaLevelPressureHpa",
  "temperatureC",
  "dewPointC",
  "windSpeedMps",
  "windDirectionDeg",
  "cloudCoverPercent",
  "precipitationMmHr",
  "sensibleHeatFluxWm2",
  "latentHeatFluxWm2",
] as const;

const LEVEL_FIELDS = [
  "pressureHpa",
  "heightM",
  "temperatureC",
  "relativeHumidityPercent",
  "windDirectionDeg",
  "windSpeedMps",
] as const;

export function fileUrl(
  variableLevel: string,
  date: string,
  runHour: string,
  forecastHour: number,
): string {
  const name =
    `${date}T${runHour}Z_MSC_REPS_${variableLevel}_` +
    `RLatLon0.09x0.09_PT${String(forecastHour).padStart(3, "0")}H.grib2`;
  return (
    `${datamartBase()}/${date}/WXO-DD/ensemble/reps/10km/grib2/` +
    `${runHour}/${String(forecastHour).padStart(3, "0")}/${name}`
  );
}

export function forecastHoursFromSteps(steps: string | undefined): number[] {
  if (steps === undefined) {
    return [...FORECAST_HOURS];
  }
  const hours = steps
    .split(",")
    .map((step) => Number.parseInt(step, 10))
    .sort((a, b) => a - b);
  for (const hour of hours) {
    if (!FORECAST_HOURS.includes(hour)) {
      throw new Error(`forecast hour ${hour} is not on the REPS 3-hourly schedule`);
    }
  }
  return hours;
}

export async function latestCompleteRun(
  fetchImpl: TransportFetch = keepAliveFetch,
  now: () => Date = () => new Date(),
): Promise<string | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of RUN_HOURS) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      if (await exists(fileUrl("UGRD_AGL-10m", date, hour, LAST_FORECAST_HOUR), fetchImpl)) {
        return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${hour}:00:00Z`;
      }
    }
  }
  return null;
}

/** Keyed by GRIB perturbationNumber (0 is the control member), then site slug. */
export type MemberValues = Record<number, Record<string, number>>;

export interface WindMemberSamples {
  southPoleLatitude: number;
  southPoleLongitude: number;
  values: Record<string, number>;
}

export interface EnsembleSite {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  timeZone?: string;
}

export async function sampleScalarMembers(
  data: Uint8Array,
  sites: readonly EnsembleSite[],
  field: string,
  decodeJ2k?: DecodeJ2kAsync,
  decodeJ2kSampled?: DecodeJ2kSampled,
): Promise<MemberValues> {
  const members: MemberValues = {};
  const parsed: Array<{ grib: GribField; grid: ReturnType<typeof parseGrid>; member: number }> = [];
  for (const message of splitMessages(data)) {
    for (const grib of parseFields(message)) {
      const grid = parseGrid(grib.section3);
      if (grid.kind !== "rotated") {
        throw new Error(`REPS ${field} file is not on the rotated grid`);
      }
      parsed.push({ grib, grid, member: requiredPerturbationNumber(grib.section4, field) });
    }
  }
  await Promise.all(
    parsed.map(async ({ grib, grid, member }) => {
      const points = sites.map((site) => nearestGridpoint(grid, site.latitude, site.longitude));
      const sampled = await sampleFieldValuesAsync(
        grib,
        Uint32Array.from(points, (point) => point.index),
        {
          ...(decodeJ2k !== undefined ? { decodeJ2k } : {}),
          ...(decodeJ2kSampled !== undefined ? { decodeJ2kSampled } : {}),
          missingValue: ECCODES_MISSING_VALUE,
        },
      );
      const values: Record<string, number> = {};
      for (let i = 0; i < sites.length; i++) {
        const masked = sampled.missingMask !== undefined && sampled.missingMask[i] === 1;
        values[sites[i]!.slug] = memberRequiredValue(
          masked ? null : sampled.values[i],
          field,
          sites[i]!,
          member,
        );
      }
      members[member] = values;
    }),
  );
  requireAllMembers(members, field);
  return members;
}

export async function sampleWindMembers(
  data: Uint8Array,
  sites: readonly EnsembleSite[],
  decodeJ2k?: DecodeJ2kAsync,
  decodeJ2kSampled?: DecodeJ2kSampled,
): Promise<Record<number, WindMemberSamples>> {
  const members: Record<number, WindMemberSamples> = {};
  const parsed: Array<{
    grib: GribField;
    grid: Extract<ReturnType<typeof parseGrid>, { kind: "rotated" }>;
    member: number;
  }> = [];
  for (const message of splitMessages(data)) {
    for (const grib of parseFields(message)) {
      const grid = parseGrid(grib.section3);
      if (grid.kind !== "rotated") {
        throw new Error("REPS wind file is not on the rotated grid");
      }
      if (grid.angleOfRotation !== 0.0) {
        throw new Error("REPS wind grid has an unexpected rotation angle");
      }
      if (!grid.uvRelativeToGrid) {
        throw new Error("REPS wind components are unexpectedly earth-relative");
      }
      parsed.push({
        grib,
        grid,
        member: requiredPerturbationNumber(grib.section4, "wind component"),
      });
    }
  }
  await Promise.all(
    parsed.map(async ({ grib, grid, member }) => {
      const points = sites.map((site) => nearestGridpoint(grid, site.latitude, site.longitude));
      const sampled = await sampleFieldValuesAsync(
        grib,
        Uint32Array.from(points, (point) => point.index),
        {
          ...(decodeJ2k !== undefined ? { decodeJ2k } : {}),
          ...(decodeJ2kSampled !== undefined ? { decodeJ2kSampled } : {}),
          missingValue: ECCODES_MISSING_VALUE,
        },
      );
      const values: Record<string, number> = {};
      for (let i = 0; i < sites.length; i++) {
        const masked = sampled.missingMask !== undefined && sampled.missingMask[i] === 1;
        values[sites[i]!.slug] = memberRequiredValue(
          masked ? null : sampled.values[i],
          "wind component",
          sites[i]!,
          member,
        );
      }
      members[member] = {
        southPoleLatitude: grid.southPoleLatitude,
        southPoleLongitude: grid.southPoleLongitude,
        values,
      };
    }),
  );
  requireAllMembers(members, "wind component");
  return members;
}

function requiredPerturbationNumber(section4: Uint8Array, field: string): number {
  const member = parseProduct(section4).perturbationNumber;
  if (member === undefined) {
    throw new Error(`REPS ${field} message carries no perturbationNumber`);
  }
  return member;
}

function requireAllMembers(members: Record<number, unknown>, field: string): void {
  const carried = Object.keys(members)
    .map((key) => Number.parseInt(key, 10))
    .sort((a, b) => a - b);
  if (carried.length !== MEMBER_COUNT || carried.some((member, index) => member !== index)) {
    throw new Error(`REPS ${field} file carries members [${carried.join(", ")}], expected 0–20`);
  }
}

interface EnsembleHour {
  [field: string]: unknown;
  levels: Record<number, Record<string, number>>;
  validAt: string;
}

function emptyEnsembleHour(validAt: string): EnsembleHour {
  return {
    cloudCoverPercent: Number.NaN,
    latentHeatFluxWm2: Number.NaN,
    levels: {},
    precipitationMm: Number.NaN,
    seaLevelPressureHpa: Number.NaN,
    relativeHumidityPercent: Number.NaN,
    sensibleHeatFluxWm2: Number.NaN,
    temperatureC: Number.NaN,
    validAt,
    windDirectionDeg: Number.NaN,
    windSpeedMps: Number.NaN,
  };
}

function isCompleteRawLevel(level: Record<string, number>): boolean {
  return LEVEL_FIELDS.every((field) => field in level);
}

export interface ForecastSlot {
  forecastHour: number;
  validAt: string;
}

export interface BuildDocumentsOptions {
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  decodeJ2k?: DecodeJ2kAsync;
  generatedAt?: () => string;
}

export interface EnsembleDocument {
  schemaVersion: number;
  model: string;
  run: { referenceTime: string; generatedAt: string; members: number };
  site: Record<string, unknown> & { id: string };
  semantics: ForecastSemantics;
  hours: Array<Record<string, unknown>>;
}

export interface BuildDocumentsResult {
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
  documents: EnsembleDocument[];
}

export async function buildDocuments(
  referenceTime: string,
  forecastSlots: readonly ForecastSlot[],
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildDocumentsOptions = {},
): Promise<BuildDocumentsResult> {
  const pool = options.decodeJ2k === undefined ? lazyJ2kPool() : undefined;
  const decodeJ2k = options.decodeJ2k ?? pool!.decode;
  try {
    return await sampleDocuments(
      referenceTime,
      forecastSlots,
      sites,
      stats,
      options,
      decodeJ2k,
      pool?.decodeSampled,
    );
  } finally {
    await pool?.close();
  }
}

async function sampleDocuments(
  referenceTime: string,
  forecastSlots: readonly ForecastSlot[],
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildDocumentsOptions,
  decodeJ2k: DecodeJ2kAsync,
  decodeJ2kSampled: DecodeJ2kSampled | undefined,
): Promise<BuildDocumentsResult> {
  const runDate = referenceTime.slice(0, 10).replaceAll("-", "");
  const runHour = referenceTime.slice(11, 13);
  const fetchGate = concurrencyLimit(FETCH_CONCURRENCY);
  const rawFetch = options.fetchBytes ?? ((url: string) => fetchBytes(url, { stats }));
  const wireFetch = (url: string): Promise<Uint8Array> => fetchGate(() => rawFetch(url));

  const fetchMembers = async (
    variableLevel: string,
    forecastHour: number,
    field: string,
  ): Promise<MemberValues> =>
    sampleScalarMembers(
      await wireFetch(fileUrl(variableLevel, runDate, runHour, forecastHour)),
      sites,
      field,
      decodeJ2k,
      decodeJ2kSampled,
    );

  const terrain = await fetchMembers(TERRAIN_VARIABLE, 0, "model elevation");

  const hours: Record<string, Record<number, EnsembleHour[]>> = Object.fromEntries(
    sites.map((site) => [
      site.slug,
      Object.fromEntries(
        PERTURBATION_NUMBERS.map((member) => [
          member,
          forecastSlots.map((slot) => emptyEnsembleHour(slot.validAt)),
        ]),
      ),
    ]),
  );

  const store = (
    hourIndex: number,
    field: string,
    values: MemberValues,
    convert: (value: number) => unknown,
  ): void => {
    for (const member of PERTURBATION_NUMBERS) {
      for (const site of sites) {
        hours[site.slug]![member]![hourIndex]![field] = convert(values[member]![site.slug]!);
      }
    }
  };

  const surfaceTask =
    (hourIndex: number, field: string, variableLevel: string, convert: (value: number) => number) =>
    async (): Promise<void> => {
      const values = await fetchMembers(
        variableLevel,
        forecastSlots[hourIndex]!.forecastHour,
        field,
      );
      store(hourIndex, field, values, convert);
    };

  const pressureTask =
    (
      hourIndex: number,
      field: string,
      variable: string,
      pressureHpa: number,
      convert: (value: number) => number,
    ) =>
    async (): Promise<void> => {
      const values = await fetchMembers(
        `${variable}_ISBL-${String(pressureHpa).padStart(4, "0")}`,
        forecastSlots[hourIndex]!.forecastHour,
        `${field}@${pressureHpa}`,
      );
      for (const member of PERTURBATION_NUMBERS) {
        for (const site of sites) {
          const levels = hours[site.slug]![member]![hourIndex]!.levels;
          (levels[pressureHpa] ??= { pressureHpa })[field] = convert(values[member]![site.slug]!);
        }
      }
    };

  const accumulated = new Map<number, Promise<MemberValues>>();
  accumulated.set(
    0,
    Promise.resolve(
      Object.fromEntries(
        PERTURBATION_NUMBERS.map((member) => [
          member,
          Object.fromEntries(sites.map((site) => [site.slug, 0.0])),
        ]),
      ),
    ),
  );

  const accumulatedPrecip = (forecastHour: number): Promise<MemberValues> => {
    let cached = accumulated.get(forecastHour);
    if (cached === undefined) {
      cached = fetchMembers(PRECIP_ACCUMULATION_VARIABLE, forecastHour, "precipitationMm");
      accumulated.set(forecastHour, cached);
    }
    return cached;
  };

  const precipTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const current = await accumulatedPrecip(forecastHour);
    const previous = await accumulatedPrecip(forecastHour - STEP_HOURS);
    for (const member of PERTURBATION_NUMBERS) {
      for (const site of sites) {
        const slug = site.slug;
        hours[slug]![member]![hourIndex]!["precipitationMm"] =
          Math.max(0.0, current[member]![slug]! - previous[member]![slug]!) / STEP_HOURS;
      }
    }
  };

  const windTask =
    (hourIndex: number, levelToken: string, pressureHpa: number | null) =>
    async (): Promise<void> => {
      const forecastHour = forecastSlots[hourIndex]!.forecastHour;
      const uMembers = await sampleWindMembers(
        await wireFetch(fileUrl(`UGRD_${levelToken}`, runDate, runHour, forecastHour)),
        sites,
        decodeJ2k,
        decodeJ2kSampled,
      );
      const vMembers = await sampleWindMembers(
        await wireFetch(fileUrl(`VGRD_${levelToken}`, runDate, runHour, forecastHour)),
        sites,
        decodeJ2k,
        decodeJ2kSampled,
      );
      for (const member of PERTURBATION_NUMBERS) {
        for (const site of sites) {
          const slug = site.slug;
          const [east, north] = earthWind(
            uMembers[member]!.values[slug]!,
            vMembers[member]!.values[slug]!,
            site.latitude,
            site.longitude,
            uMembers[member]!.southPoleLatitude,
            uMembers[member]!.southPoleLongitude,
          );
          const [speed, direction] = windFromUv(east, north);
          const hour = hours[slug]![member]![hourIndex]!;
          if (pressureHpa === null) {
            hour["windSpeedMps"] = speed;
            hour["windDirectionDeg"] = direction;
          } else {
            const level = (hour.levels[pressureHpa] ??= { pressureHpa });
            level["windSpeedMps"] = speed;
            level["windDirectionDeg"] = direction;
          }
        }
      }
    };

  const tasksForHour = (hourIndex: number): Array<() => Promise<void>> => {
    const tasks: Array<() => Promise<void>> = Object.entries(SURFACE_FIELDS).map(
      ([field, [variableLevel, convert]]) => surfaceTask(hourIndex, field, variableLevel, convert),
    );
    tasks.push(precipTask(hourIndex));
    for (const pressureHpa of PRESSURE_LEVELS) {
      for (const [field, [variable, convert]] of Object.entries(PRESSURE_FIELDS)) {
        tasks.push(pressureTask(hourIndex, field, variable, pressureHpa, convert));
      }
    }
    for (const [levelToken, pressureHpa] of Object.entries(WIND_LEVEL_TOKENS)) {
      tasks.push(windTask(hourIndex, levelToken, pressureHpa));
    }
    return tasks;
  };

  const lastHourIndex = forecastSlots.length - 1;
  await runConcurrent(tasksForHour(lastHourIndex), TASK_CONCURRENCY);
  const earlierTasks: Array<() => Promise<void>> = [];
  for (let index = 0; index < lastHourIndex; index += 1) {
    earlierTasks.push(...tasksForHour(index));
  }
  await runConcurrent(earlierTasks, TASK_CONCURRENCY);

  const generatedAt = (options.generatedAt ?? profileInstant)();
  const documents: EnsembleDocument[] = [];
  for (const site of sites) {
    const memberProfiles = PERTURBATION_NUMBERS.map((member) =>
      deriveMemberProfile(
        site,
        hours[site.slug]![member]!,
        terrain[member]![site.slug]!,
        referenceTime,
        generatedAt,
      ),
    );
    documents.push({
      schemaVersion: SITE_FORECAST_SCHEMA_VERSION,
      model: SLUG,
      run: {
        referenceTime,
        generatedAt,
        members: MEMBER_COUNT,
      },
      site: {
        id: site.slug,
        name: site.name,
        latitude: site.latitude,
        longitude: site.longitude,
        modelElevationM: terrain[0]![site.slug]!,
        ...(site.timeZone ? { timeZone: site.timeZone } : {}),
      },
      semantics: SEMANTICS,
      hours: aggregateHours(memberProfiles),
    });
  }
  return {
    firstForecastHour: forecastSlots[0]!.forecastHour,
    forecastHours: forecastSlots.length,
    lastForecastHour: forecastSlots[lastHourIndex]!.forecastHour,
    documents,
  };
}

function deriveMemberProfile(
  site: Site,
  memberHours: readonly EnsembleHour[],
  modelElevationM: number,
  referenceTime: string,
  generatedAt: string,
): MemberProfile {
  const sourceHours: SourceHour[] = [];
  for (const hour of memberHours) {
    const levels = Object.values(hour.levels).sort((a, b) => a["pressureHpa"]! - b["pressureHpa"]!);
    const incomplete = levels
      .filter((level) => !isCompleteRawLevel(level))
      .map((level) => level["pressureHpa"]);
    if (levels.length !== PRESSURE_LEVELS.length || incomplete.length > 0) {
      throw new Error(
        `REPS column for ${site.name} at ${hour.validAt} is missing ` +
          `level data (${incomplete.length > 0 ? incomplete.join(", ") : "whole levels"})`,
      );
    }
    const { levels: _levels, relativeHumidityPercent, ...rest } = hour;
    sourceHours.push({
      ...rest,
      dewPointDepressionC: dewPointDepression(
        hour["temperatureC"] as number,
        relativeHumidityPercent as number,
      ),
      levels: levels
        .map((level) => withDewPointDepression(level))
        .sort((a, b) => a["heightM"]! - b["heightM"]!),
    } as unknown as SourceHour);
  }
  return deriveSiteForecast(
    {
      generatedAt,
      hours: sourceHours,
      latitude: site.latitude,
      longitude: site.longitude,
      modelElevationM,
      referenceTime,
      siteId: site.slug,
      siteName: site.name,
      siteTimeZone: site.timeZone,
    },
    SLUG,
    SEMANTICS,
  ) as unknown as MemberProfile;
}

export function aggregateHours(
  memberProfiles: readonly MemberProfile[],
): Array<Record<string, unknown>> {
  return aggregateMemberProfiles(memberProfiles, {
    surfaceScalars: SURFACE_SCALARS,
  });
}

export interface RepsBuildOptions {
  sitesPath: string;
  history?: boolean;
  outputRoot?: string;
  maxSteps?: number;
  referenceTime?: string;
  dataset?: DatasetOptions;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  decodeJ2k?: DecodeJ2kAsync;
  fetch?: TransportFetch;
  log?: (line: string) => void;
  now?: () => Date;
  generatedAt?: () => string;
}

export async function buildReps(options: RepsBuildOptions): Promise<boolean> {
  const log = options.log ?? ((line: string) => console.log(line));
  const sitesPath = options.sitesPath;
  const outputRoot = options.outputRoot ?? "data";
  const sites = parseSites(readFileSync(sitesPath, "utf-8"), sitesPath);

  let referenceTime: string;
  if (options.referenceTime !== undefined) {
    referenceTime = canonicalInstant(options.referenceTime);
  } else {
    const probed = await latestCompleteRun(options.fetch, options.now);
    if (probed === null) {
      log("No complete REPS run is available.");
      return false;
    }
    referenceTime = probed;
  }
  if ((await publishedReferenceTime(SLUG, options.dataset)) === referenceTime) {
    log(`REPS run ${referenceTime} is already published.`);
    return false;
  }

  const cap = options.maxSteps ?? envMaxSteps();
  const forecastSlots = FORECAST_HOURS.slice(0, cap ?? FORECAST_HOURS.length).map((hour) => ({
    forecastHour: hour,
    validAt: validTime(referenceTime, hour),
  }));
  log(
    `Building REPS ensemble ${referenceTime} for ${sites.length} sites ` +
      `(${forecastSlots.length} steps × ${MEMBER_COUNT} members)…`,
  );
  const startedAt = performance.now();
  const stats = new DownloadCounters();
  const buildOptions: BuildDocumentsOptions = {};
  if (options.fetchBytes !== undefined) buildOptions.fetchBytes = options.fetchBytes;
  if (options.decodeJ2k !== undefined) buildOptions.decodeJ2k = options.decodeJ2k;
  if (options.generatedAt !== undefined) buildOptions.generatedAt = options.generatedAt;
  const result = await buildDocuments(referenceTime, forecastSlots, sites, stats, buildOptions);

  const outDir = join(outputRoot, SLUG);
  const sitesDir = join(outDir, "sites");
  mkdirSync(sitesDir, { recursive: true });
  const month = referenceTime.slice(0, 7);
  for (const raw of result.documents) {
    const document = roundDocument(raw) as ArchivableProfile;
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
    memberCount: MEMBER_COUNT,
    model: SLUG,
    referenceTime,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sites: sites.map((site) => ({ name: site.name, slug: site.slug })),
    stats: manifestStats(stats, startedAt),
  };
  writeJson(join(outDir, "manifest.json"), manifest, { compact: false });
  log(
    `Published ${result.documents.length} ensemble documents for ${referenceTime} ` +
      `(${stats.requests} downloads, ${Math.floor(stats.responseBytes / (1024 * 1024))} MiB).`,
  );
  for (const line of stats.transportReport()) {
    log(line);
  }
  return true;
}

function canonicalInstant(value: string): string {
  const ms = Date.parse(value.replace(/Z$/, "+00:00"));
  if (Number.isNaN(ms)) {
    throw new Error(`referenceTime ${value} is not an ISO instant`);
  }
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}
