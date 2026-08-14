import {
  STATION_SCHEMA_VERSION,
  stationSchema,
  unavailableStation,
  type Station,
  type StationCurrent,
  type StationFeed,
  type StationLiveFrame,
  type StationMeta,
} from "../contract.js";
import { loadCampbellStation } from "./adapters/campbell.js";
import { loadTempestStation } from "./adapters/tempest.js";
import { loadWindnerdStation } from "./adapters/windnerd.js";
import { openWindnerdLive } from "./adapters/windnerd-live.js";
import {
  stationConfigSchema,
  type CustomStationConfig,
  type CustomStationIdentity,
  type StationConfig,
  type StationConfigInput,
} from "./config.js";
import {
  logUpstreamFailure,
  resolveEnvironment,
  unavailableReasonForError,
  type ResolvedEnvironment,
  type ServerEnvironment,
} from "./environment.js";
import type { ZodError } from "zod";

export const DEFAULT_HISTORY_HOURS = 6;

export type StationsResolver = (
  request?: Request,
) => Promise<StationConfigInput[]> | StationConfigInput[];
export type StationsInput = StationConfigInput[] | StationsResolver;

export type LoadStationFeedOptions = {
  stations: StationsInput;
  primaryStationId?: string;
  historyHours?: number;
  maxHistoryHours?: number;
  environment?: ServerEnvironment;
  request?: Request;
};

export type LoadStationCurrentOptions = LoadStationFeedOptions & {
  stationId: string;
};

export class UnknownStationError extends Error {
  constructor(stationId: string) {
    super(`no station is configured with id "${stationId}"`);
    this.name = "UnknownStationError";
  }
}

export class StationLiveUnsupportedError extends Error {
  constructor(stationId: string) {
    super(`station "${stationId}" has no live stream`);
    this.name = "StationLiveUnsupportedError";
  }
}

export type OpenStationLiveOptions = {
  stations: StationsInput;
  stationId: string;
  environment?: ServerEnvironment;
  signal?: AbortSignal;
  request?: Request;
};

/**
 * Opens the live stream for one configured station. Unknown ids throw
 * UnknownStationError; stations whose vendor has no live arm — and stations
 * whose config failed validation — throw StationLiveUnsupportedError; connect
 * failures reject with the upstream error. One call is one upstream
 * connection.
 */
export async function openStationLive(
  options: OpenStationLiveOptions,
): Promise<ReadableStream<StationLiveFrame>> {
  const environment = resolveEnvironment(options.environment);
  const assembled = assembleStations(
    await resolveStations({ stations: options.stations, request: options.request }, environment),
    environment,
  );
  const entry = assembled.find(
    (candidate) =>
      ("config" in candidate ? candidate.config.id : candidate.degraded.id) === options.stationId,
  );
  if (!entry) throw new UnknownStationError(options.stationId);
  if ("degraded" in entry || entry.config.vendor !== "windnerd") {
    throw new StationLiveUnsupportedError(options.stationId);
  }
  return openWindnerdLive(entry.config, {
    environment,
    signal: options.signal,
  });
}

export async function loadStationFeed(options: LoadStationFeedOptions): Promise<StationFeed> {
  const environment = resolveEnvironment(options.environment);
  const assembled = assembleStations(await resolveStations(options, environment), environment);
  const historyHours = effectiveHistoryHours(options);
  const stations = await Promise.all(
    assembled.map((entry) => loadAssembledStation(entry, environment, historyHours, "full")),
  );
  return {
    schemaVersion: STATION_SCHEMA_VERSION,
    servedAt: environment.now().toISOString(),
    primaryStationId: options.primaryStationId ?? null,
    stations,
  };
}

export async function loadStationCurrent(
  options: LoadStationCurrentOptions,
): Promise<StationCurrent> {
  const environment = resolveEnvironment(options.environment);
  const assembled = assembleStations(await resolveStations(options, environment), environment);
  const entry = assembled.find(
    (candidate) =>
      ("config" in candidate ? candidate.config.id : candidate.degraded.id) === options.stationId,
  );
  if (!entry) throw new UnknownStationError(options.stationId);
  const station = await loadAssembledStation(
    entry,
    environment,
    effectiveHistoryHours(options),
    "current",
  );
  return {
    schemaVersion: STATION_SCHEMA_VERSION,
    servedAt: environment.now().toISOString(),
    station,
  };
}

async function resolveStations(
  options: LoadStationFeedOptions,
  environment: ResolvedEnvironment,
): Promise<StationConfigInput[]> {
  if (Array.isArray(options.stations)) return options.stations;
  const resolved = await options.stations(options.request);
  if (!Array.isArray(resolved)) {
    environment.logger({
      level: "error",
      code: "resolver_invalid",
      message: "stations resolver returned a non-array; serving an empty feed",
      detail: { returned: typeof resolved },
    });
    return [];
  }
  return resolved;
}

function effectiveHistoryHours(options: {
  historyHours?: number;
  maxHistoryHours?: number;
}): number {
  const ceiling = options.maxHistoryHours ?? DEFAULT_HISTORY_HOURS;
  const requested = options.historyHours;
  const wanted =
    requested != null && Number.isFinite(requested) && requested > 0 ? requested : ceiling;
  return options.maxHistoryHours != null ? Math.min(wanted, options.maxHistoryHours) : wanted;
}

type AssembledStation = { config: StationConfig } | { degraded: Station };

export function assembleStations(
  candidates: StationConfigInput[],
  environment: ResolvedEnvironment,
): AssembledStation[] {
  const seen = new Set<string>();
  return candidates.map((candidate, index): AssembledStation => {
    const result = stationConfigSchema.safeParse(candidate);
    if (!result.success) {
      environment.logger({
        level: "warn",
        code: "config_invalid",
        message: `station config at index ${index} is invalid — serving it unavailable (not_configured)`,
        detail: { index, issues: describeIssues(result.error) },
      });
      const meta = scavengedMeta(candidate, index);
      seen.add(meta.id);
      return { degraded: unavailableStation(meta, "not_configured") };
    }
    if (seen.has(result.data.id)) {
      environment.logger({
        level: "warn",
        code: "duplicate_station",
        message:
          `duplicate station id "${result.data.id}" at index ${index} — ` +
          "serving the duplicate unavailable (not_configured); ids must be unique per feed",
        detail: { index, station: result.data.id },
      });
      return { degraded: unavailableStation(configFallbackMeta(result.data), "not_configured") };
    }
    seen.add(result.data.id);
    return { config: result.data };
  });
}

function describeIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(config)"}: ${issue.message}`)
    .join("; ");
}

function scavengedMeta(candidate: unknown, index: number): StationMeta {
  const record =
    typeof candidate === "object" && candidate !== null
      ? (candidate as Record<string, unknown>)
      : {};
  const id = typeof record.id === "string" && record.id.length > 0 ? record.id : `station-${index}`;
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : id;
  return {
    id,
    name,
    sourceLabel: typeof record.vendor === "string" ? record.vendor : "unknown",
    pageUrl: null,
    latitude: null,
    longitude: null,
    timeZone: null,
    elevationM: null,
    capabilities: { gustLull: false, temperature: false, conditions: false, history: false },
    samplingWindowSeconds: null,
    recommendedPollSeconds: 60,
  };
}

function configFallbackMeta(config: StationConfig): StationMeta {
  return {
    id: config.id,
    name: config.name,
    sourceLabel: config.vendor,
    pageUrl: null,
    latitude: config.latitude ?? null,
    longitude: config.longitude ?? null,
    timeZone: config.timeZone ?? null,
    elevationM: config.elevationM ?? null,
    capabilities: { gustLull: false, temperature: false, conditions: false, history: false },
    samplingWindowSeconds: null,
    recommendedPollSeconds: 60,
  };
}

async function loadAssembledStation(
  entry: AssembledStation,
  environment: ResolvedEnvironment,
  historyHours: number,
  mode: "full" | "current",
): Promise<Station> {
  if ("degraded" in entry) return entry.degraded;
  return loadStation(entry.config, environment, historyHours, mode).catch((error) =>
    neverThrewButDid(entry.config, environment, error),
  );
}

async function loadStation(
  config: StationConfig,
  environment: ResolvedEnvironment,
  historyHours: number,
  mode: "full" | "current",
): Promise<Station> {
  switch (config.vendor) {
    case "windnerd":
      return loadWindnerdStation(config, { historyHours, mode, environment });
    case "tempest":
      return loadTempestStation(config, { historyHours, mode, environment });
    case "campbell":
      return loadCampbellStation(config, { historyHours, mode, environment });
    case "custom":
      return loadCustomStation(config, environment, historyHours, mode);
  }
}

async function loadCustomStation(
  config: CustomStationConfig,
  environment: ResolvedEnvironment,
  historyHours: number,
  mode: "full" | "current",
): Promise<Station> {
  let returned: Station;
  try {
    returned = await config.load({
      environment,
      historyHours,
      mode,
      station: customStationIdentity(config),
    });
  } catch (error) {
    logUpstreamFailure(environment, `${config.name} live wind unavailable`, error, {
      station: config.id,
    });
    return unavailableStation(configFallbackMeta(config), unavailableReasonForError(error));
  }
  const parsed = stationSchema.safeParse(returned);
  if (!parsed.success) {
    environment.logger({
      level: "error",
      code: "custom_contract_break",
      message: `${config.name} custom loader returned an invalid Station`,
      detail: { station: config.id, issues: describeIssues(parsed.error) },
    });
    return unavailableStation(configFallbackMeta(config), "contract_break");
  }
  return mode === "current" && parsed.data.status === "ok"
    ? { ...parsed.data, history: null }
    : parsed.data;
}

function customStationIdentity(config: CustomStationConfig): CustomStationIdentity {
  return {
    id: config.id,
    name: config.name,
    elevationM: config.elevationM ?? null,
    latitude: config.latitude ?? null,
    longitude: config.longitude ?? null,
    timeZone: config.timeZone ?? null,
    pageUrl: config.pageUrl ?? null,
  };
}

function neverThrewButDid(
  config: StationConfig,
  environment: ResolvedEnvironment,
  error: unknown,
): Station {
  environment.logger({
    level: "error",
    code: "adapter_threw",
    message: `${config.name} adapter threw instead of degrading`,
    detail: { error: error instanceof Error ? error.message : String(error), station: config.id },
  });
  return unavailableStation(configFallbackMeta(config), "contract_break");
}
