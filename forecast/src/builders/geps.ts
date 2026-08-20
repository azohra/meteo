import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ECCODES_MISSING_VALUE,
  nearestGridpoint,
  parseFields,
  parseGrid,
  parseProduct,
  sampleFieldValuesAsync,
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
  manifestInstant,
  maxSteps as envMaxSteps,
  memberRequiredValue,
  profileInstant,
  runConcurrent,
  validTime,
  withDewPointDepression,
} from "./common.js";
import { TASK_CONCURRENCY, concurrencyLimit, lazyJ2kPool } from "./eccc.js";

export const SLUG = "geps";

export const SEMANTICS: ForecastSemantics = { precipitation: "windowMeanRate" };

export const MEMBER_COUNT = 21;
export const PERTURBATION_NUMBERS: readonly number[] = Array.from(
  { length: MEMBER_COUNT },
  (_unused, member) => member,
);
export const RUN_HOURS = ["12", "00"] as const;
export const LAST_FORECAST_HOUR = 384;
export const FORECAST_HOURS: readonly number[] = [
  ...Array.from({ length: 64 }, (_unused, index) => 3 * (index + 1)),
  ...Array.from({ length: 32 }, (_unused, index) => 198 + 6 * index),
];

export const FETCH_CONCURRENCY = 5;

export const CAPE_SENTINEL = -1.0;

export const SURFACE_FIELDS: Record<
  string,
  [variableLevel: string, convert: (v: number) => number]
> = {
  cloudCoverPercent: ["TCDC_SFC_0", (v) => v],
  seaLevelPressureHpa: ["PRMSL_MSL_0", (v) => v / 100.0],
  relativeHumidityPercent: ["RH_TGL_2m", (v) => v],
  temperatureC: ["TMP_TGL_2m", (v) => v - KELVIN],
};
export const CAPE_VARIABLE = "CAPE_SFC_0";
export const CIN_VARIABLE = "CIN_SFC_0";
export const FLUX_ACCUMULATION_VARIABLES: Record<string, string> = {
  sensibleHeatFluxWm2: "SHTFL_SFC_0",
  latentHeatFluxWm2: "LHTFL_SFC_0",
};
export const PRECIP_ACCUMULATION_VARIABLE = "APCP_SFC_0";
export const TERRAIN_VARIABLE = "HGT_SFC_0";
export const TERRAIN_DAM_TO_M = 10.0;
export const SURFACE_PRESSURE_VARIABLE = "PRES_SFC_0";
export const TERRAIN_CEILING_M = 9000.0;
export const STANDARD_SEA_LEVEL_PA = 101325.0;
export const BAROMETRIC_SCALE_HEIGHT_M = 8434.0;
export const TERRAIN_PRESSURE_TOLERANCE_M = 1000.0;
export const PRESSURE_FIELDS: Record<string, [variable: string, convert: (v: number) => number]> = {
  heightM: ["HGT", (v) => v],
  relativeHumidityPercent: ["RH", (v) => v],
  temperatureC: ["TMP", (v) => v - KELVIN],
};
export const PRESSURE_LEVELS = [1000, 925, 850, 700, 500] as const;

// Level token → pressureHpa; null marks the 10 m surface wind.
export const WIND_LEVEL_TOKENS: Record<string, number | null> = {
  TGL_10m: null,
  ...Object.fromEntries(
    PRESSURE_LEVELS.map((level) => [`ISBL_${String(level).padStart(4, "0")}`, level]),
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
  "capeJkg",
  "cinJkg",
] as const;

const LEVEL_FIELDS = [
  "pressureHpa",
  "heightM",
  "temperatureC",
  "relativeHumidityPercent",
  "windDirectionDeg",
  "windSpeedMps",
] as const;

export function previousScheduledHour(forecastHour: number): number {
  return forecastHour <= 192 ? forecastHour - 3 : forecastHour - 6;
}

export function fileUrl(
  variableLevel: string,
  date: string,
  runHour: string,
  forecastHour: number,
): string {
  const name =
    `CMC_geps-raw_${variableLevel}_latlon0p5x0p5_` +
    `${date}${runHour}_P${String(forecastHour).padStart(3, "0")}_allmbrs.grib2`;
  return (
    `${datamartBase()}/${date}/WXO-DD/ensemble/geps/grib2/raw/` +
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
      throw new Error(
        `forecast hour ${hour} is not on the GEPS schedule (3-hourly to 192, 6-hourly to 384)`,
      );
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
      if (await exists(fileUrl("UGRD_TGL_10m", date, hour, LAST_FORECAST_HOUR), fetchImpl)) {
        return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${hour}:00:00Z`;
      }
    }
  }
  return null;
}

/** Keyed by GRIB perturbationNumber (0 is the control member), then site slug. */
export type MemberValues = Record<number, Record<string, number>>;

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
      if (grid.kind !== "latlon") {
        throw new Error(`GEPS ${field} file is not on the regular 0.5° grid`);
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
): Promise<MemberValues> {
  const members: MemberValues = {};
  const parsed: Array<{ grib: GribField; grid: ReturnType<typeof parseGrid>; member: number }> = [];
  for (const message of splitMessages(data)) {
    for (const grib of parseFields(message)) {
      const grid = parseGrid(grib.section3);
      if (grid.kind !== "latlon") {
        throw new Error("GEPS wind file is not on the regular 0.5° grid");
      }
      if (grid.uvRelativeToGrid) {
        throw new Error("GEPS wind components are unexpectedly grid-relative");
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
      members[member] = values;
    }),
  );
  requireAllMembers(members, "wind component");
  return members;
}

function requiredPerturbationNumber(section4: Uint8Array, field: string): number {
  const member = parseProduct(section4).perturbationNumber;
  if (member === undefined) {
    throw new Error(`GEPS ${field} message carries no perturbationNumber`);
  }
  return member;
}

function requireAllMembers(members: Record<number, unknown>, field: string): void {
  const carried = Object.keys(members)
    .map((key) => Number.parseInt(key, 10))
    .sort((a, b) => a - b);
  if (carried.length !== MEMBER_COUNT || carried.some((member, index) => member !== index)) {
    throw new Error(`GEPS ${field} file carries members [${carried.join(", ")}], expected 0–20`);
  }
}

export function requirePlausibleModelElevation(
  terrain: MemberValues,
  surfacePressure: MemberValues,
  sites: readonly EnsembleSite[],
): void {
  for (const site of sites) {
    const elevation = terrain[0]![site.slug]!;
    const pressurePa = surfacePressure[0]![site.slug]!;
    const impliedM = BAROMETRIC_SCALE_HEIGHT_M * Math.log(STANDARD_SEA_LEVEL_PA / pressurePa);
    if (Math.abs(impliedM - elevation) > TERRAIN_PRESSURE_TOLERANCE_M) {
      throw new Error(
        `GEPS model elevation for ${site.name} is ${elevation.toFixed(1)} m, ` +
          `but its own ${(pressurePa / 100).toFixed(1)} hPa surface pressure puts ` +
          `the surface near ${impliedM.toFixed(0)} m — further apart than any ` +
          "weather allows; the surface-orography encoding has changed " +
          "(see TERRAIN_DAM_TO_M)",
      );
    }
    if (elevation > TERRAIN_CEILING_M) {
      throw new Error(
        `GEPS model elevation for ${site.name} is ${elevation.toFixed(1)} m — ` +
          "higher than any Earth terrain; the surface-orography encoding " +
          "has changed (see TERRAIN_DAM_TO_M)",
      );
    }
  }
}

interface EnsembleHour {
  [field: string]: unknown;
  levels: Record<number, Record<string, number>>;
  validAt: string;
}

function emptyEnsembleHour(validAt: string): EnsembleHour {
  return {
    capeJkg: Number.NaN,
    cinJkg: Number.NaN,
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

  const terrain: MemberValues = Object.fromEntries(
    Object.entries(await fetchMembers(TERRAIN_VARIABLE, 0, "model elevation")).map(
      ([member, memberValues]) => [
        member,
        Object.fromEntries(
          Object.entries(memberValues).map(([slug, value]) => [slug, value * TERRAIN_DAM_TO_M]),
        ),
      ],
    ),
  );
  const surfacePressure = await fetchMembers(SURFACE_PRESSURE_VARIABLE, 0, "surface pressure");
  requirePlausibleModelElevation(terrain, surfacePressure, sites);

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

  const capeTask = (hourIndex: number) => async (): Promise<void> => {
    const values = await fetchMembers(
      CAPE_VARIABLE,
      forecastSlots[hourIndex]!.forecastHour,
      "capeJkg",
    );
    store(hourIndex, "capeJkg", values, (value) => maskSentinel(value, CAPE_SENTINEL));
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
        `${variable}_ISBL_${String(pressureHpa).padStart(4, "0")}`,
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

  const zeroMembers = (): MemberValues =>
    Object.fromEntries(
      PERTURBATION_NUMBERS.map((member) => [
        member,
        Object.fromEntries(sites.map((site) => [site.slug, 0.0])),
      ]),
    );
  const accumulated = new Map<string, Promise<MemberValues>>();
  for (const variable of [
    PRECIP_ACCUMULATION_VARIABLE,
    ...Object.values(FLUX_ACCUMULATION_VARIABLES),
  ]) {
    accumulated.set(`${variable}#0`, Promise.resolve(zeroMembers()));
  }

  const accumulatedMembers = (variable: string, forecastHour: number): Promise<MemberValues> => {
    const key = `${variable}#${forecastHour}`;
    let cached = accumulated.get(key);
    if (cached === undefined) {
      cached = fetchMembers(variable, forecastHour, `accumulated ${variable}`);
      accumulated.set(key, cached);
    }
    return cached;
  };

  const accumulationTask =
    (
      hourIndex: number,
      field: string,
      variable: string,
      rate: (delta: number, windowHours: number) => number,
    ) =>
    async (): Promise<void> => {
      const forecastHour = forecastSlots[hourIndex]!.forecastHour;
      const windowStart = previousScheduledHour(forecastHour);
      const current = await accumulatedMembers(variable, forecastHour);
      const previous = await accumulatedMembers(variable, windowStart);
      const windowHours = forecastHour - windowStart;
      for (const member of PERTURBATION_NUMBERS) {
        for (const site of sites) {
          const slug = site.slug;
          hours[slug]![member]![hourIndex]![field] = rate(
            current[member]![slug]! - previous[member]![slug]!,
            windowHours,
          );
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
          const [speed, direction] = windFromUv(uMembers[member]![slug]!, vMembers[member]![slug]!);
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
    tasks.push(capeTask(hourIndex));
    tasks.push(surfaceTask(hourIndex, "cinJkg", CIN_VARIABLE, (v) => v));
    tasks.push(
      accumulationTask(
        hourIndex,
        "precipitationMm",
        PRECIP_ACCUMULATION_VARIABLE,
        (delta, windowHours) => Math.max(0.0, delta) / windowHours,
      ),
    );
    for (const [field, variable] of Object.entries(FLUX_ACCUMULATION_VARIABLES)) {
      tasks.push(
        accumulationTask(
          hourIndex,
          field,
          variable,
          (delta, windowHours) => delta / (windowHours * 3600),
        ),
      );
    }
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
        `GEPS column for ${site.name} at ${hour.validAt} is missing ` +
          `level data (${incomplete.length > 0 ? incomplete.join(", ") : "whole levels"})`,
      );
    }
    const { levels: _levels, relativeHumidityPercent, capeJkg, ...rest } = hour;
    const source: Record<string, unknown> = {
      ...rest,
      dewPointDepressionC: dewPointDepression(
        hour["temperatureC"] as number,
        relativeHumidityPercent as number,
      ),
      levels: levels
        .map((level) => withDewPointDepression(level))
        .sort((a, b) => a["heightM"]! - b["heightM"]!),
    };
    if (capeJkg !== null) {
      source["capeJkg"] = capeJkg;
    }
    sourceHours.push(source as unknown as SourceHour);
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
    // Only CAPE can be absent from a member surface: the -1.0 sentinel
    // masks to a dropped key. Every other scalar is seeded per hour and a
    // missing one is a builder bug the aggregator must refuse.
    optionalSurfaceScalars: ["capeJkg"],
  });
}

export interface GepsBuildOptions {
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

export async function buildGeps(options: GepsBuildOptions): Promise<boolean> {
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
      log("No complete GEPS run is available.");
      return false;
    }
    referenceTime = probed;
  }
  if ((await publishedReferenceTime(SLUG, options.dataset)) === referenceTime) {
    log(`GEPS run ${referenceTime} is already published.`);
    return false;
  }

  const cap = options.maxSteps ?? envMaxSteps();
  const forecastSlots = FORECAST_HOURS.slice(0, cap ?? FORECAST_HOURS.length).map((hour) => ({
    forecastHour: hour,
    validAt: validTime(referenceTime, hour),
  }));
  log(
    `Building GEPS ensemble ${referenceTime} for ${sites.length} sites ` +
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
