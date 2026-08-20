import type { DatasetOptions } from "../dataset.js";
import { datamartBase } from "../providers/datamart.js";
import { SMOKE_SCHEMA_VERSION } from "@azohra/meteo.briefing/contract";
import type { Site } from "../sites.js";
import {
  DownloadCounters,
  exists,
  keepAliveFetch,
  type TransportFetch,
} from "../providers/transport.js";
import {
  parseCycleStamp,
  profileInstant,
  runConcurrent,
  runReferenceTime,
  validTime,
} from "./common.js";
import { publishRun } from "./publication.js";
import { TASK_CONCURRENCY, liveDatamartWire, type DatamartWire } from "../providers/datamart.js";
import { concurrencyLimit } from "../providers/transport.js";

export const SLUG = "raqdps";
export const PATH = "model_raqdps/10km/grib2";
export const FILE_PREFIX = "MSC_RAQDPS";
export const GRID_TOKEN = "RLatLon0.09";
export const RUN_HOURS = ["12", "00"] as const; // probed newest-first
export const FORECAST_HOURS = 72;
export const FETCH_CONCURRENCY = 5;
export const MAX_NEAREST_KM = 15.0;

export const SMOKE_FIELDS: Record<string, [variable: string, convert: (v: number) => number]> = {
  pm25Ugm3: ["PM2.5_Sfc", (v) => v * 1e9],
  smokePlumeSurfaceUgm3: ["PM2.5-WildfireSmokePlume_Sfc", (v) => v * 1e9],
  smokePlumeColumnMgm2: ["PM2.5-WildfireSmokePlume_EAtm", (v) => v * 1e6],
};

export function fileUrl(
  date: string,
  runHour: string,
  forecastHour: number,
  variable: string,
): string {
  const step = String(forecastHour).padStart(3, "0");
  const name = `${date}T${runHour}Z_${FILE_PREFIX}_${variable}_${GRID_TOKEN}_PT${step}H.grib2`;
  return `${datamartBase()}/${date}/WXO-DD/${PATH}/${runHour}/${step}/${name}`;
}

export interface RaqdpsRun {
  date: string;
  hour: string;
}

export async function latestCompleteRun(
  fetchImpl: TransportFetch = keepAliveFetch,
  now: () => Date = () => new Date(),
): Promise<RaqdpsRun | null> {
  const current = now();
  for (const dayOffset of [0, 1]) {
    const day = new Date(current.getTime() - dayOffset * 86_400_000);
    const date = day.toISOString().slice(0, 10).replaceAll("-", "");
    for (const hour of RUN_HOURS) {
      if (dayOffset === 0 && Number.parseInt(hour, 10) > current.getUTCHours()) {
        continue;
      }
      const probe = fileUrl(date, hour, FORECAST_HOURS, SMOKE_FIELDS["pm25Ugm3"]![0]);
      if (await exists(probe, fetchImpl)) {
        return { date, hour };
      }
    }
  }
  return null;
}

export interface BuildDocumentsOptions {
  maxSteps?: number;
  wire?: DatamartWire;
  generatedAt?: () => string;
}

export interface SmokeDocument {
  schemaVersion: number;
  model: string;
  run: { referenceTime: string; generatedAt: string };
  site: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    timeZone?: string;
  };
  hours: Array<Record<string, unknown>>;
}

export interface BuildDocumentsResult {
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
  documents: SmokeDocument[];
}

export async function buildDocuments(
  run: RaqdpsRun,
  referenceTime: string,
  sites: readonly Site[],
  stats: DownloadCounters,
  options: BuildDocumentsOptions = {},
): Promise<BuildDocumentsResult> {
  const wire = options.wire ?? liveDatamartWire({ stats });
  try {
    return await sampleDocuments(run, referenceTime, sites, wire, options);
  } finally {
    if (options.wire === undefined) {
      await wire.close?.();
    }
  }
}

async function sampleDocuments(
  run: RaqdpsRun,
  referenceTime: string,
  sites: readonly Site[],
  wire: DatamartWire,
  options: BuildDocumentsOptions,
): Promise<BuildDocumentsResult> {
  const cap = options.maxSteps;
  let forecastSlots = Array.from({ length: FORECAST_HOURS }, (_, index) => ({
    forecastHour: index + 1,
    validAt: validTime(referenceTime, index + 1),
  }));
  if (cap !== undefined) {
    forecastSlots = forecastSlots.slice(0, cap);
  }

  const fetchGate = concurrencyLimit(FETCH_CONCURRENCY);
  const sample = async (
    variable: string,
    forecastHour: number,
  ): Promise<Record<string, number | null>> => {
    const url = fileUrl(run.date, run.hour, forecastHour, variable);
    const message = await fetchGate(() => wire.fetchBytes(url));
    return wire.sampleSites(message, sites, MAX_NEAREST_KM);
  };

  const valuesBySite: Record<string, Array<Record<string, number>>> = Object.fromEntries(
    sites.map((site) => [site.slug, forecastSlots.map(() => ({}))]),
  );

  const fieldTask =
    (hourIndex: number, fieldName: string, variable: string, convert: (v: number) => number) =>
    async (): Promise<void> => {
      const values = await sample(variable, forecastSlots[hourIndex]!.forecastHour);
      for (const site of sites) {
        const value = values[site.slug];
        if (value === null || value === undefined || !Number.isFinite(value)) {
          throw new Error(`Datamart returned no ${fieldName} for ${site.name}`);
        }
        valuesBySite[site.slug]![hourIndex]![fieldName] = Math.max(0.0, convert(value));
      }
    };

  await runConcurrent(
    forecastSlots.flatMap((_slot, hourIndex) =>
      Object.entries(SMOKE_FIELDS).map(([fieldName, [variable, convert]]) =>
        fieldTask(hourIndex, fieldName, variable, convert),
      ),
    ),
    TASK_CONCURRENCY,
  );

  const generatedAt = (options.generatedAt ?? profileInstant)();
  const documents: SmokeDocument[] = sites.map((site) => ({
    schemaVersion: SMOKE_SCHEMA_VERSION,
    model: SLUG,
    run: { referenceTime, generatedAt },
    site: {
      id: site.slug,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      ...(site.timeZone ? { timeZone: site.timeZone } : {}),
    },
    hours: forecastSlots.map((slot, hourIndex) => ({
      validAt: slot.validAt,
      ...Object.fromEntries(
        Object.keys(SMOKE_FIELDS).map((fieldName) => [
          fieldName,
          valuesBySite[site.slug]![hourIndex]![fieldName]!,
        ]),
      ),
    })),
  }));
  return {
    firstForecastHour: forecastSlots[0]!.forecastHour,
    forecastHours: forecastSlots.length,
    lastForecastHour: forecastSlots[forecastSlots.length - 1]!.forecastHour,
    documents,
  };
}

export interface RaqdpsBuildOptions {
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

export async function buildRaqdps(options: RaqdpsBuildOptions): Promise<boolean> {
  let run: RaqdpsRun;
  return publishRun(
    {
      slug: SLUG,
      label: "RAQDPS",
      publishedNoun: "RAQDPS smoke documents",
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
        const buildOptions: BuildDocumentsOptions = {};
        if (options.maxSteps !== undefined) buildOptions.maxSteps = options.maxSteps;
        if (options.wire !== undefined) buildOptions.wire = options.wire;
        if (options.generatedAt !== undefined) buildOptions.generatedAt = options.generatedAt;
        return buildDocuments(run, referenceTime, sites, stats, buildOptions);
      },
    },
    options,
  );
}

export function pinnedRun(referenceTime: string): RaqdpsRun {
  return parseCycleStamp(referenceTime, RUN_HOURS, "raqdps");
}
