import {
  ECCODES_MISSING_VALUE,
  earthWind,
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
  SITE_FORECAST_SCHEMA_VERSION,
  type ForecastSemantics,
} from "@azohra/meteo.briefing/contract";
import { TASK_CONCURRENCY, datamartBase, fetchBytes, lazyJ2kPool } from "../providers/datamart.js";
import type { DatasetOptions } from "../dataset.js";
import { deriveSiteForecast, type SourceHour } from "../derive.js";
import { aggregateMemberProfiles, type MemberProfile } from "../ensemble.js";
import { dewPointC, dewPointDepressionC } from "@azohra/meteo.briefing/derive";
import { windFromUv } from "../providers/noaa.js";
import { maskSentinel } from "../sentinel.js";
import type { Site } from "../sites.js";
import {
  DownloadCounters,
  concurrencyLimit,
  exists,
  keepAliveFetch,
  type TransportFetch,
} from "../providers/transport.js";
import {
  KELVIN,
  memberRequiredValue,
  profileInstant,
  runConcurrent,
  runReferenceTime,
  validTime,
  withDewPointDepression,
} from "./common.js";
import { publishRun } from "./publication.js";

export const SEMANTICS: ForecastSemantics = { precipitation: "windowMeanRate" };

export const MEMBER_COUNT = 21;
export const PERTURBATION_NUMBERS: readonly number[] = Array.from(
  { length: MEMBER_COUNT },
  (_unused, member) => member,
);

export const FETCH_CONCURRENCY = 5;

export const PRESSURE_FIELDS: Record<string, [variable: string, convert: (v: number) => number]> = {
  heightM: ["HGT", (v) => v],
  relativeHumidityPercent: ["RH", (v) => v],
  temperatureC: ["TMP", (v) => v - KELVIN],
};
export const PRESSURE_LEVELS = [1000, 925, 850, 700, 500] as const;

const LEVEL_FIELDS = [
  "pressureHpa",
  "heightM",
  "temperatureC",
  "relativeHumidityPercent",
  "windDirectionDeg",
  "windSpeedMps",
] as const;

/** Keyed by GRIB perturbationNumber (0 is the control member), then site slug. */
export type MemberValues = Record<number, Record<string, number>>;

export interface WindMemberSamples {
  values: Record<string, number>;
  southPoleLatitude?: number;
  southPoleLongitude?: number;
}

export interface EnsembleSite {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  timeZone?: string;
}

/** One ECCC all-members ensemble feed; the engine below is shared. */
export interface EnsembleModel {
  slug: string;
  label: string;
  runHours: readonly string[];
  forecastHours: readonly number[];
  lastForecastHour: number;
  /** The variable whose final-hour file marks a run complete. */
  probeVariable: string;
  gridKind: "latlon" | "rotated";
  /** Names the expected grid in wrong-grid errors. */
  gridDescription: string;
  /**
   * "earthRelative" components sample straight through (a grid-relative
   * flag fails loudly); "gridRelative" components rotate to earth via the
   * grid's south pole.
   */
  windComponents: "earthRelative" | "gridRelative";
  fileUrl(variableLevel: string, date: string, runHour: string, forecastHour: number): string;
  surfaceFields: Record<string, [variableLevel: string, convert: (v: number) => number]>;
  surfaceScalars: readonly string[];
  /** See the GEPS descriptor: only a sentinel-masked scalar may be absent. */
  optionalSurfaceScalars: readonly string[];
  isobaricVariable(variable: string, pressureHpa: number): string;
  /** Level token → pressureHpa; null marks the 10 m surface wind. */
  windLevelTokens: Record<string, number | null>;
  capeVariable?: string;
  capeSentinel?: number;
  cinVariable?: string;
  /** Accumulated (run-total) heat fluxes, differenced per window. */
  fluxAccumulationVariables?: Record<string, string>;
  precipAccumulationVariable: string;
  previousScheduledHour(forecastHour: number): number;
  terrainVariable: string;
  /** Factor from the feed's terrain unit to metres. */
  terrainToM: number;
  /** Extra terrain validation, given the scaled terrain and the fetcher. */
  verifyTerrain?(
    terrain: MemberValues,
    fetchMembers: FetchMembers,
    sites: readonly EnsembleSite[],
  ): Promise<void>;
}

type FetchMembers = (
  variableLevel: string,
  forecastHour: number,
  field: string,
) => Promise<MemberValues>;

export const GEPS: EnsembleModel = {
  slug: "geps",
  label: "GEPS",
  runHours: ["12", "00"],
  lastForecastHour: 384,
  forecastHours: [
    ...Array.from({ length: 64 }, (_unused, index) => 3 * (index + 1)),
    ...Array.from({ length: 32 }, (_unused, index) => 198 + 6 * index),
  ],
  probeVariable: "UGRD_TGL_10m",
  gridKind: "latlon",
  gridDescription: "the regular 0.5° grid",
  windComponents: "earthRelative",
  fileUrl(variableLevel, date, runHour, forecastHour) {
    const name =
      `CMC_geps-raw_${variableLevel}_latlon0p5x0p5_` +
      `${date}${runHour}_P${String(forecastHour).padStart(3, "0")}_allmbrs.grib2`;
    return (
      `${datamartBase()}/${date}/WXO-DD/ensemble/geps/grib2/raw/` +
      `${runHour}/${String(forecastHour).padStart(3, "0")}/${name}`
    );
  },
  surfaceFields: {
    cloudCoverPercent: ["TCDC_SFC_0", (v) => v],
    seaLevelPressureHpa: ["PRMSL_MSL_0", (v) => v / 100.0],
    relativeHumidityPercent: ["RH_TGL_2m", (v) => v],
    temperatureC: ["TMP_TGL_2m", (v) => v - KELVIN],
  },
  surfaceScalars: [
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
  ],
  // Only CAPE can be absent from a member surface: the -1.0 sentinel
  // masks to a dropped key. Every other scalar is seeded per hour and a
  // missing one is a builder bug the aggregator must refuse.
  optionalSurfaceScalars: ["capeJkg"],
  isobaricVariable: (variable, pressureHpa) =>
    `${variable}_ISBL_${String(pressureHpa).padStart(4, "0")}`,
  windLevelTokens: {
    TGL_10m: null,
    ...Object.fromEntries(
      PRESSURE_LEVELS.map((level) => [`ISBL_${String(level).padStart(4, "0")}`, level]),
    ),
  },
  capeVariable: "CAPE_SFC_0",
  capeSentinel: -1.0,
  cinVariable: "CIN_SFC_0",
  fluxAccumulationVariables: {
    sensibleHeatFluxWm2: "SHTFL_SFC_0",
    latentHeatFluxWm2: "LHTFL_SFC_0",
  },
  precipAccumulationVariable: "APCP_SFC_0",
  // 3-hourly to 192, then 6-hourly to 384.
  previousScheduledHour: (forecastHour) =>
    forecastHour <= 192 ? forecastHour - 3 : forecastHour - 6,
  terrainVariable: "HGT_SFC_0",
  terrainToM: 10.0, // the feed encodes surface orography in decametres
  verifyTerrain: async (terrain, fetchMembers, sites) => {
    const surfacePressure = await fetchMembers(SURFACE_PRESSURE_VARIABLE, 0, "surface pressure");
    requirePlausibleModelElevation(terrain, surfacePressure, sites);
  },
};

export const REPS: EnsembleModel = {
  slug: "reps",
  label: "REPS",
  runHours: ["18", "12", "06", "00"],
  lastForecastHour: 72,
  forecastHours: Array.from({ length: 72 / 3 }, (_unused, index) => 3 * (index + 1)),
  probeVariable: "UGRD_AGL-10m",
  gridKind: "rotated",
  gridDescription: "the rotated grid",
  windComponents: "gridRelative",
  fileUrl(variableLevel, date, runHour, forecastHour) {
    const name =
      `${date}T${runHour}Z_MSC_REPS_${variableLevel}_` +
      `RLatLon0.09x0.09_PT${String(forecastHour).padStart(3, "0")}H.grib2`;
    return (
      `${datamartBase()}/${date}/WXO-DD/ensemble/reps/10km/grib2/` +
      `${runHour}/${String(forecastHour).padStart(3, "0")}/${name}`
    );
  },
  surfaceFields: {
    cloudCoverPercent: ["TCDC_SFC", (v) => v],
    latentHeatFluxWm2: ["LHTFL_SFC", (v) => v],
    seaLevelPressureHpa: ["PRMSL_MSL", (v) => v / 100.0],
    relativeHumidityPercent: ["RH_AGL-2m", (v) => v],
    sensibleHeatFluxWm2: ["SHTFL_SFC", (v) => v],
    temperatureC: ["TMP_AGL-2m", (v) => v - KELVIN],
  },
  surfaceScalars: [
    "seaLevelPressureHpa",
    "temperatureC",
    "dewPointC",
    "windSpeedMps",
    "windDirectionDeg",
    "cloudCoverPercent",
    "precipitationMmHr",
    "sensibleHeatFluxWm2",
    "latentHeatFluxWm2",
  ],
  optionalSurfaceScalars: [],
  isobaricVariable: (variable, pressureHpa) =>
    `${variable}_ISBL-${String(pressureHpa).padStart(4, "0")}`,
  windLevelTokens: {
    "AGL-10m": null,
    ...Object.fromEntries(
      PRESSURE_LEVELS.map((level) => [`ISBL-${String(level).padStart(4, "0")}`, level]),
    ),
  },
  precipAccumulationVariable: "APCP_SFC",
  previousScheduledHour: (forecastHour) => forecastHour - 3,
  terrainVariable: "HGT_SFC",
  terrainToM: 1.0,
};

// GEPS's terrain plausibility guard: the feed's decametre encoding once
// changed silently, so the datum is cross-checked against the model's own
// surface pressure and an Earth ceiling.
export const SURFACE_PRESSURE_VARIABLE = "PRES_SFC_0";
export const TERRAIN_CEILING_M = 9000.0;
export const STANDARD_SEA_LEVEL_PA = 101325.0;
export const BAROMETRIC_SCALE_HEIGHT_M = 8434.0;
export const TERRAIN_PRESSURE_TOLERANCE_M = 1000.0;

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
          "(see GEPS.terrainToM)",
      );
    }
    if (elevation > TERRAIN_CEILING_M) {
      throw new Error(
        `GEPS model elevation for ${site.name} is ${elevation.toFixed(1)} m — ` +
          "higher than any Earth terrain; the surface-orography encoding " +
          "has changed (see GEPS.terrainToM)",
      );
    }
  }
}

export async function latestCompleteRun(
  model: EnsembleModel,
  fetchImpl: TransportFetch = keepAliveFetch,
  now: () => Date = () => new Date(),
): Promise<string | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of model.runHours) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      const probe = model.fileUrl(model.probeVariable, date, hour, model.lastForecastHour);
      if (await exists(probe, fetchImpl)) {
        return runReferenceTime({ date, hour });
      }
    }
  }
  return null;
}

export async function sampleScalarMembers(
  model: EnsembleModel,
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
      if (grid.kind !== model.gridKind) {
        throw new Error(`${model.label} ${field} file is not on ${model.gridDescription}`);
      }
      parsed.push({ grib, grid, member: requiredPerturbationNumber(model, grib.section4, field) });
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
  requireAllMembers(model, members, field);
  return members;
}

export async function sampleWindMembers(
  model: EnsembleModel,
  data: Uint8Array,
  sites: readonly EnsembleSite[],
  decodeJ2k?: DecodeJ2kAsync,
  decodeJ2kSampled?: DecodeJ2kSampled,
): Promise<Record<number, WindMemberSamples>> {
  const members: Record<number, WindMemberSamples> = {};
  const parsed: Array<{
    grib: GribField;
    grid: ReturnType<typeof parseGrid>;
    member: number;
  }> = [];
  for (const message of splitMessages(data)) {
    for (const grib of parseFields(message)) {
      const grid = parseGrid(grib.section3);
      if (grid.kind !== model.gridKind) {
        throw new Error(`${model.label} wind file is not on ${model.gridDescription}`);
      }
      if (model.windComponents === "earthRelative") {
        if (grid.uvRelativeToGrid) {
          throw new Error(`${model.label} wind components are unexpectedly grid-relative`);
        }
      } else {
        if (grid.kind === "rotated" && grid.angleOfRotation !== 0.0) {
          throw new Error(`${model.label} wind grid has an unexpected rotation angle`);
        }
        if (!grid.uvRelativeToGrid) {
          throw new Error(`${model.label} wind components are unexpectedly earth-relative`);
        }
      }
      parsed.push({
        grib,
        grid,
        member: requiredPerturbationNumber(model, grib.section4, "wind component"),
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
      members[member] =
        grid.kind === "rotated"
          ? {
              values,
              southPoleLatitude: grid.southPoleLatitude,
              southPoleLongitude: grid.southPoleLongitude,
            }
          : { values };
    }),
  );
  requireAllMembers(model, members, "wind component");
  return members;
}

function requiredPerturbationNumber(
  model: EnsembleModel,
  section4: Uint8Array,
  field: string,
): number {
  const member = parseProduct(section4).perturbationNumber;
  if (member === undefined) {
    throw new Error(`${model.label} ${field} message carries no perturbationNumber`);
  }
  return member;
}

function requireAllMembers(
  model: EnsembleModel,
  members: Record<number, unknown>,
  field: string,
): void {
  const carried = Object.keys(members)
    .map((key) => Number.parseInt(key, 10))
    .sort((a, b) => a - b);
  if (carried.length !== MEMBER_COUNT || carried.some((member, index) => member !== index)) {
    throw new Error(
      `${model.label} ${field} file carries members [${carried.join(", ")}], expected 0–20`,
    );
  }
}

interface EnsembleHour {
  [field: string]: unknown;
  levels: Record<number, Record<string, number>>;
  validAt: string;
}

function emptyEnsembleHour(model: EnsembleModel, validAt: string): EnsembleHour {
  return {
    ...(model.capeVariable !== undefined ? { capeJkg: Number.NaN } : {}),
    ...(model.cinVariable !== undefined ? { cinJkg: Number.NaN } : {}),
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
  model: EnsembleModel,
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
      model,
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
  model: EnsembleModel,
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

  const fetchMembers: FetchMembers = async (variableLevel, forecastHour, field) =>
    sampleScalarMembers(
      model,
      await wireFetch(model.fileUrl(variableLevel, runDate, runHour, forecastHour)),
      sites,
      field,
      decodeJ2k,
      decodeJ2kSampled,
    );

  const rawTerrain = await fetchMembers(model.terrainVariable, 0, "model elevation");
  const terrain: MemberValues = Object.fromEntries(
    Object.entries(rawTerrain).map(([member, memberValues]) => [
      member,
      Object.fromEntries(
        Object.entries(memberValues).map(([slug, value]) => [slug, value * model.terrainToM]),
      ),
    ]),
  );
  await model.verifyTerrain?.(terrain, fetchMembers, sites);

  const hours: Record<string, Record<number, EnsembleHour[]>> = Object.fromEntries(
    sites.map((site) => [
      site.slug,
      Object.fromEntries(
        PERTURBATION_NUMBERS.map((member) => [
          member,
          forecastSlots.map((slot) => emptyEnsembleHour(model, slot.validAt)),
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
      model.capeVariable!,
      forecastSlots[hourIndex]!.forecastHour,
      "capeJkg",
    );
    store(hourIndex, "capeJkg", values, (value) => maskSentinel(value, model.capeSentinel!));
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
        model.isobaricVariable(variable, pressureHpa),
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
    model.precipAccumulationVariable,
    ...Object.values(model.fluxAccumulationVariables ?? {}),
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
      const windowStart = model.previousScheduledHour(forecastHour);
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
        model,
        await wireFetch(model.fileUrl(`UGRD_${levelToken}`, runDate, runHour, forecastHour)),
        sites,
        decodeJ2k,
        decodeJ2kSampled,
      );
      const vMembers = await sampleWindMembers(
        model,
        await wireFetch(model.fileUrl(`VGRD_${levelToken}`, runDate, runHour, forecastHour)),
        sites,
        decodeJ2k,
        decodeJ2kSampled,
      );
      for (const member of PERTURBATION_NUMBERS) {
        for (const site of sites) {
          const slug = site.slug;
          const u = uMembers[member]!.values[slug]!;
          const v = vMembers[member]!.values[slug]!;
          const [east, north] =
            model.windComponents === "gridRelative"
              ? earthWind(
                  u,
                  v,
                  site.latitude,
                  site.longitude,
                  uMembers[member]!.southPoleLatitude!,
                  uMembers[member]!.southPoleLongitude!,
                )
              : [u, v];
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
    const tasks: Array<() => Promise<void>> = Object.entries(model.surfaceFields).map(
      ([field, [variableLevel, convert]]) => surfaceTask(hourIndex, field, variableLevel, convert),
    );
    if (model.capeVariable !== undefined) {
      tasks.push(capeTask(hourIndex));
    }
    if (model.cinVariable !== undefined) {
      tasks.push(surfaceTask(hourIndex, "cinJkg", model.cinVariable, (v) => v));
    }
    tasks.push(
      accumulationTask(
        hourIndex,
        "precipitationMm",
        model.precipAccumulationVariable,
        (delta, windowHours) => Math.max(0.0, delta) / windowHours,
      ),
    );
    for (const [field, variable] of Object.entries(model.fluxAccumulationVariables ?? {})) {
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
    for (const [levelToken, pressureHpa] of Object.entries(model.windLevelTokens)) {
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
        model,
        site,
        hours[site.slug]![member]!,
        terrain[member]![site.slug]!,
        referenceTime,
        generatedAt,
      ),
    );
    documents.push({
      schemaVersion: SITE_FORECAST_SCHEMA_VERSION,
      model: model.slug,
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
      hours: aggregateHours(model, memberProfiles),
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
  model: EnsembleModel,
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
        `${model.label} column for ${site.name} at ${hour.validAt} is missing ` +
          `level data (${incomplete.length > 0 ? incomplete.join(", ") : "whole levels"})`,
      );
    }
    const { levels: _levels, relativeHumidityPercent, capeJkg, ...rest } = hour;
    const source: Record<string, unknown> = {
      ...rest,
      dewPointDepressionC: dewPointDepressionC(
        hour["temperatureC"] as number,
        dewPointC(hour["temperatureC"] as number, relativeHumidityPercent as number),
      ),
      levels: levels
        .map((level) => withDewPointDepression(level))
        .sort((a, b) => a["heightM"]! - b["heightM"]!),
    };
    if (capeJkg !== undefined && capeJkg !== null) {
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
    model.slug,
    SEMANTICS,
  ) as unknown as MemberProfile;
}

export function aggregateHours(
  model: EnsembleModel,
  memberProfiles: readonly MemberProfile[],
): Array<Record<string, unknown>> {
  return aggregateMemberProfiles(memberProfiles, {
    surfaceScalars: model.surfaceScalars,
    optionalSurfaceScalars: model.optionalSurfaceScalars,
  });
}

export interface EnsembleBuildOptions {
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

export async function buildEnsemble(
  model: EnsembleModel,
  options: EnsembleBuildOptions,
): Promise<boolean> {
  const cap = options.maxSteps;
  const slots = (referenceTime: string): ForecastSlot[] =>
    model.forecastHours.slice(0, cap ?? model.forecastHours.length).map((hour) => ({
      forecastHour: hour,
      validAt: validTime(referenceTime, hour),
    }));
  return publishRun(
    {
      slug: model.slug,
      label: model.label,
      publishedNoun: "ensemble documents",
      manifestExtras: { memberCount: MEMBER_COUNT },
      resolveRun: async () => {
        if (options.referenceTime !== undefined) {
          return canonicalInstant(options.referenceTime);
        }
        return latestCompleteRun(model, options.fetch, options.now);
      },
      buildingLine: (referenceTime, siteCount) =>
        `Building ${model.label} ensemble ${referenceTime} for ${siteCount} sites ` +
        `(${slots(referenceTime).length} steps × ${MEMBER_COUNT} members)…`,
      build: async (referenceTime, sites, stats) => {
        const buildOptions: BuildDocumentsOptions = {};
        if (options.fetchBytes !== undefined) buildOptions.fetchBytes = options.fetchBytes;
        if (options.decodeJ2k !== undefined) buildOptions.decodeJ2k = options.decodeJ2k;
        if (options.generatedAt !== undefined) buildOptions.generatedAt = options.generatedAt;
        return buildDocuments(
          model,
          referenceTime,
          slots(referenceTime),
          sites,
          stats,
          buildOptions,
        );
      },
    },
    options,
  );
}

export function buildGeps(options: EnsembleBuildOptions): Promise<boolean> {
  return buildEnsemble(GEPS, options);
}

export function buildReps(options: EnsembleBuildOptions): Promise<boolean> {
  return buildEnsemble(REPS, options);
}

function canonicalInstant(value: string): string {
  const ms = Date.parse(value.replace(/Z$/, "+00:00"));
  if (Number.isNaN(ms)) {
    throw new Error(`referenceTime ${value} is not an ISO instant`);
  }
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}
