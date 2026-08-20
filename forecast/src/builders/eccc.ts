import type { ForecastSemantics } from "@azohra/meteo.briefing/contract";
import type { DatasetOptions } from "../dataset.js";
import {
  FETCH_CONCURRENCY,
  NotFoundError,
  TASK_CONCURRENCY,
  datamartBase,
  liveDatamartWire,
  type DatamartWire,
} from "../providers/datamart.js";
import { deriveSiteForecast, type SourceHour } from "../derive.js";
import type { ArchivableProfile } from "../history.js";
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
  /** Log and error display name; defaults to the slug. */
  label?: string;
  /** The published-count noun in the final log line; defaults to "profiles". */
  publishedNoun?: string;
  // Either the WXO-DD grammar's three parts, or a whole-URL override for
  // feeds outside that tree (the alpha Datamart).
  path?: string;
  filePrefix?: string;
  gridToken?: string;
  fileUrl?: (date: string, runHour: string, forecastHour: number, variable: string) => string;
  runHours: readonly string[];
  forecastHours: readonly number[];
  /** The run-completeness probe: this variable's last-hour file. */
  probeVariable: string;
  surfaceVariables: Record<string, readonly [variable: string, convert: (v: number) => number]>;
  // Present as a pair when 2 m depression derives from T and Td; absent
  // when the feed publishes DEPR directly (then DEPR rides
  // surfaceVariables).
  temperatureVariable?: string;
  dewPointVariable?: string;
  pressureVariable: (fieldName: string, pressureHpa: number) => string;
  omegaLevels: readonly number[];
  terrainVariable: string;
  /** Where the terrain file lives: a fixed hour, or the first built slot for feeds with no hour-0 directory. */
  terrainHour: number | "firstSlot";
  /** Absent means no domain cap: the feed covers every catalogued site. */
  maxNearestKm?: number;
  precipWindowVariable?: string;
  precipRunTotalVariable?: string;
  levelsForHour: (forecastHour: number) => readonly number[];
  /** True for feeds that publish every level every hour, where a missing level file is a broken run, not thinning. */
  missingLevelFileFatal?: boolean;
  gustMaxVariable?: string;
  gustInstantVariable?: string;
  capeVariable?: string;
  cinVariable?: string;
  capeSentinel: number;
  capeForHour: (forecastHour: number) => boolean;
  pblVariable?: string;
}

export function modelLabel(model: DatamartModel): string {
  return model.label ?? model.slug;
}

export function modelSemantics(model: DatamartModel): ForecastSemantics {
  // Precipitation semantics follow the transport: window or run-total
  // accumulations publish a window-mean rate; a plain surface rate field
  // (PRATE) is instantaneous.
  const windowed =
    model.precipWindowVariable !== undefined || model.precipRunTotalVariable !== undefined;
  const semantics: ForecastSemantics = {
    precipitation: windowed ? "windowMeanRate" : "instantRate",
  };
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
    cloudCoverPercent: ["TCDC_Sfc", (v) => v],
    latentHeatFluxWm2: ["LHTFL_Sfc", (v) => v],
    seaLevelPressureHpa: ["PRMSL_MSL", (v) => v / 100.0],
    sensibleHeatFluxWm2: ["SHTFL_Sfc", (v) => v],
    windDirectionDeg: ["WDIR_AGL-10m", (v) => v],
    windSpeedMps: ["WIND_AGL-10m", (v) => v],
  },
  probeVariable: "TMP_AGL-2m",
  temperatureVariable: "TMP_AGL-2m",
  dewPointVariable: "DPT_AGL-2m",
  pressureVariable: oldStylePressureVariable,
  omegaLevels: [1000, 850, 700],
  terrainVariable: "HGT_Sfc",
  terrainHour: 0,
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
    cloudCoverPercent: ["TotalCloudCover_Sfc", (v) => v],
    latentHeatFluxWm2: ["LatentHeatNetFlux_Sfc", (v) => v],
    seaLevelPressureHpa: ["Pressure_MSL", (v) => v / 100.0],
    sensibleHeatFluxWm2: ["SensibleHeatNetFlux_Sfc", (v) => v],
    windDirectionDeg: ["WindDir_AGL-10m", (v) => v],
    windSpeedMps: ["WindSpeed_AGL-10m", (v) => v],
  },
  probeVariable: "AirTemp_AGL-2m",
  temperatureVariable: "AirTemp_AGL-2m",
  dewPointVariable: "DewPoint_AGL-2m",
  pressureVariable: englishPressureVariable,
  omegaLevels: [850, 700],
  terrainVariable: "GeopotentialHeight_Sfc",
  terrainHour: 0,
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
    cloudCoverPercent: ["TotalCloudCover_Sfc", (v) => v],
    latentHeatFluxWm2: ["LatentHeatNetFlux_Sfc", (v) => v],
    seaLevelPressureHpa: ["Pressure_MSL", (v) => v / 100.0],
    sensibleHeatFluxWm2: ["SensibleHeatNetFlux_Sfc", (v) => v],
    windDirectionDeg: ["WindDir_AGL-10m", (v) => v],
    windSpeedMps: ["WindSpeed_AGL-10m", (v) => v],
  },
  probeVariable: "AirTemp_AGL-2m",
  temperatureVariable: "AirTemp_AGL-2m",
  dewPointVariable: "DewPoint_AGL-2m",
  pressureVariable: englishPressureVariable,
  omegaLevels: [850, 700, 600],
  terrainVariable: "GeopotentialHeight_Sfc",
  terrainHour: 0,
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
  if (model.fileUrl !== undefined) {
    return model.fileUrl(date, runHour, forecastHour, variable);
  }
  const step = String(forecastHour).padStart(3, "0");
  const name = `${date}T${runHour}Z_${model.filePrefix}_${variable}_${model.gridToken}_PT${step}H.grib2`;
  return `${datamartBase()}/${date}/WXO-DD/${model.path}/${runHour}/${step}/${name}`;
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
      const probe = fileUrl(model, date, hour, lastHour, model.probeVariable);
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
  const cap = options.maxSteps;
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

  const terrainHour =
    model.terrainHour === "firstSlot" ? forecastSlots[0]!.forecastHour : model.terrainHour;
  const terrain = await sample(model.terrainVariable, terrainHour);
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
    (hourIndex: number, fieldName: string, variable: string, convert: (v: number) => number) =>
    async (): Promise<void> => {
      const values = await sample(variable, forecastSlots[hourIndex]!.forecastHour);
      for (const site of sites) {
        const hour = hoursBySite[site.slug]![hourIndex]!;
        hour[fieldName] = convert(requiredValue("Datamart", values[site.slug], fieldName, site));
      }
    };

  // Depression is computed as T − Td: ECCC clamps its published 2 m
  // depressions at 30 K.
  const temperatureTask = (hourIndex: number) => async (): Promise<void> => {
    const forecastHour = forecastSlots[hourIndex]!.forecastHour;
    const temperature = await sample(model.temperatureVariable!, forecastHour);
    const dewPoint = await sample(model.dewPointVariable!, forecastHour);
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
          `Gust semantics broke for ${site.name} at +${forecastHour} h: ` +
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
        // WXO-DD feeds thin levels out by hour; a feed that declares its
        // level files complete treats absence as a broken run instead.
        if (error instanceof NotFoundError && model.missingLevelFileFatal !== true) {
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
    const tasks: Array<() => Promise<void>> = [];
    if (model.temperatureVariable !== undefined && model.dewPointVariable !== undefined) {
      tasks.push(temperatureTask(hourIndex));
    }
    for (const [fieldName, [variable, convert]] of Object.entries(model.surfaceVariables)) {
      tasks.push(surfaceTask(hourIndex, fieldName, variable, convert));
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
  let run: DatamartRun;
  return publishRun(
    {
      slug: model.slug,
      label: modelLabel(model),
      publishedNoun: model.publishedNoun ?? "profiles",
      resolveRun: async () => {
        if (options.referenceTime !== undefined) {
          run = pinnedRun(model, options.referenceTime);
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

export function pinnedRun(model: DatamartModel, referenceTime: string): DatamartRun {
  return parseCycleStamp(referenceTime, model.runHours, modelLabel(model));
}
