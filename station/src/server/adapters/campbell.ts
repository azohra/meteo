import type { History, HistoryPoint, Reading, Station, StationMeta } from "../../contract.js";
import { isCalm, normalizeDegrees } from "../../derive.js";
import { kmhToMps } from "@azohra/meteo.core";
import type { CampbellStationConfig } from "../config.js";
import { defineStationAdapter, type StationAdapterOptions } from "../adapter.js";
import { fetchUpstreamText, logUpstreamFailure, type ResolvedEnvironment } from "../environment.js";

const HISTORY_CACHE_TTL_SECONDS = 120;
const MAX_RESPONSE_BYTES = 524_288;

export type CampbellAdapterOptions = StationAdapterOptions;

type CampbellField = {
  name: string;
  process: string;
  type: string;
  units: string;
};

type CampbellRecord = {
  time: string;
  vals: unknown[];
};

export type CampbellTable = {
  fields: CampbellField[];
  records: CampbellRecord[];
};

type TableRole = "current" | "history";

export const CAMPBELL_FIELD_CONTRACTS = {
  current: [
    { name: "Wind_Speed", process: "Avg", type: "xsd:float", units: "kilometers/hour" },
    { name: "Wind_Lull", process: "Min", type: "xsd:float", units: "kilometers/hour" },
    { name: "Wind_Gust", process: "Max", type: "xsd:float", units: "kilometers/hour" },
    { name: "WindDir", process: "Smp", type: "xsd:float", units: "degrees" },
  ],
  history: [
    { name: "Temp", process: "Smp", type: "xsd:float", units: "Deg C" },
    { name: "Wind_Chill", process: "Smp", type: "xsd:float", units: "Deg C" },
    { name: "WindDir", process: "Smp", type: "xsd:float", units: "degrees" },
    { name: "WS_kph_Max", process: "Max", type: "xsd:float", units: "kilometers/hour" },
    { name: "WS_kph_Avg", process: "Avg", type: "xsd:float", units: "kilometers/hour" },
    { name: "WS_kph_Min", process: "Min", type: "xsd:float", units: "kilometers/hour" },
  ],
} as const;

export type CampbellTableExpectation = {
  role: TableRole;
  tableName: string;
  stationName: string;
  intervalMs: number;
  subject: string;
};

function sourceStationName(source: string): string {
  const colon = source.indexOf(":");
  return colon >= 0 ? source.slice(colon + 1) : source;
}

function tableExpectation(
  config: CampbellStationConfig,
  role: TableRole,
): CampbellTableExpectation {
  const tableName = role === "current" ? config.currentTable : config.historyTable;
  return {
    role,
    tableName,
    stationName: sourceStationName(config.source),
    intervalMs:
      role === "current"
        ? config.currentIntervalSeconds * 1_000
        : config.historyPeriodMinutes * 60_000,
    subject: `${config.name} ${tableName}`,
  };
}

function stationMeta(config: CampbellStationConfig): StationMeta {
  return {
    id: config.id,
    name: config.name,
    sourceLabel: "Campbell logger",
    pageUrl: config.pageUrl ?? null,
    latitude: config.latitude ?? null,
    longitude: config.longitude ?? null,
    timeZone: config.timeZone,
    elevationM: config.elevationM ?? null,
    capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
    samplingWindowSeconds: config.currentIntervalSeconds,
    recommendedPollSeconds: Math.max(config.currentIntervalSeconds, config.currentCacheTtlSeconds),
  };
}

type LatestAir = { temperatureC: number | null; windChillC: number | null };

function latestAirCacheKey(config: CampbellStationConfig): string {
  return `campbell/${config.baseUrl}/${config.source}/${config.historyTable}/latest-air`;
}

export const loadCampbellStation = defineStationAdapter<
  CampbellStationConfig,
  CampbellAdapterOptions
>({
  meta: stationMeta,
  load: async (config, { environment, historyHours, mode }) => {
    if (mode === "current") {
      const currentText = await fetchCurrentTable(config, environment);
      const nowMs = environment.now().getTime();
      const reading = parseCampbellCurrent(currentText, config, nowMs);
      warnOnHourSkew(environment, config, reading.observedAt, nowMs);
      const air = await peekLatestAir(config, environment);
      return {
        reading: { ...reading, temperatureC: air.temperatureC, windChillC: air.windChillC },
        history: null,
      };
    }

    const [currentSettled, historySettled] = await Promise.allSettled([
      fetchCurrentTable(config, environment),
      fetchHistoryTable(config, environment, historyHours),
    ]);

    if (currentSettled.status === "rejected") throw currentSettled.reason;
    const nowMs = environment.now().getTime();
    const current = parseCampbellCurrent(currentSettled.value, config, nowMs);
    warnOnHourSkew(environment, config, current.observedAt, nowMs);

    let air: LatestAir = { temperatureC: null, windChillC: null };
    let history: History | null = null;
    try {
      if (historySettled.status === "rejected") throw historySettled.reason;
      const parsed = parseCampbellHistory(historySettled.value, config);
      air = { temperatureC: parsed.latestTemperatureC, windChillC: parsed.latestWindChillC };
      history = { periodMinutes: config.historyPeriodMinutes, points: parsed.points };
      await environment.cache.put(
        latestAirCacheKey(config),
        JSON.stringify(air),
        HISTORY_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      logUpstreamFailure(environment, `${config.name} history unavailable`, error, {
        station: config.id,
      });
    }

    return {
      reading: {
        ...current,
        temperatureC: air.temperatureC,
        windChillC: air.windChillC,
      },
      history,
    };
  },
});

export function loadCampbellCurrent(
  config: CampbellStationConfig,
  options: CampbellAdapterOptions = {},
): Promise<Station> {
  return loadCampbellStation(config, { ...options, mode: "current" });
}

async function peekLatestAir(
  config: CampbellStationConfig,
  environment: ResolvedEnvironment,
): Promise<LatestAir> {
  const cached = await environment.cache.get(latestAirCacheKey(config));
  if (cached == null) return { temperatureC: null, windChillC: null };
  try {
    const parsed: unknown = JSON.parse(cached);
    if (!isRecord(parsed)) throw new Error("not a record");
    return {
      temperatureC: finiteOrNull(parsed.temperatureC),
      windChillC: finiteOrNull(parsed.windChillC),
    };
  } catch {
    return { temperatureC: null, windChillC: null };
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const HOUR_MS = 3_600_000;
const HOUR_SKEW_TOLERANCE_MS = 5 * 60_000;

function warnOnHourSkew(
  environment: ResolvedEnvironment,
  config: CampbellStationConfig,
  observedAtIso: string,
  nowMs: number,
): void {
  const skewMs = Math.abs(Date.parse(observedAtIso) - nowMs);
  if (Math.abs(skewMs - HOUR_MS) > HOUR_SKEW_TOLERANCE_MS) return;
  environment.logger({
    level: "warn",
    code: "clock_skew",
    message:
      `${config.name} current reading is ${Math.round(skewMs / 60_000)} min from now — ` +
      "the logger clock appears pinned to standard time; configure the fixed-offset zone " +
      `(Etc/GMT+8 for Pacific) instead of ${config.timeZone}, or vice versa`,
    detail: { station: config.id, timeZone: config.timeZone, skewMs },
  });
}

function fetchCurrentTable(config: CampbellStationConfig, environment: ResolvedEnvironment) {
  return fetchCampbellTable(config, environment, {
    table: config.currentTable,
    mode: "most-recent",
    period: 1,
    order: "real-time",
    cacheTtlSeconds: config.currentCacheTtlSeconds,
  });
}

function fetchHistoryTable(
  config: CampbellStationConfig,
  environment: ResolvedEnvironment,
  historyHours: number,
) {
  return fetchCampbellTable(config, environment, {
    table: config.historyTable,
    mode: "backfill",
    period: historyHours * 3_600,
    order: "collected",
    cacheTtlSeconds: HISTORY_CACHE_TTL_SECONDS,
  });
}

function fetchCampbellTable(
  config: CampbellStationConfig,
  environment: ResolvedEnvironment,
  query: {
    table: string;
    mode: "backfill" | "most-recent";
    period: number;
    order: "collected" | "real-time";
    cacheTtlSeconds: number;
  },
) {
  const url = new URL(config.baseUrl);
  url.searchParams.set("command", "DataQuery");
  url.searchParams.set("uri", `${config.source}.${query.table}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("mode", query.mode);
  url.searchParams.set("p1", String(query.period));
  url.searchParams.set("p2", "");
  url.searchParams.set("headsig", "0");
  url.searchParams.set("nextpoll", "60000");
  url.searchParams.set("order", query.order);

  return fetchUpstreamText(environment, {
    url,
    cacheKey: `campbell/${config.baseUrl}/${config.source}/${query.table}/${query.mode}/${query.period}/${query.order}`,
    cacheTtlSeconds: query.cacheTtlSeconds,
    subject: `${config.name} ${query.table}`,
    limitBytes: MAX_RESPONSE_BYTES,
  });
}

export function parseCampbellCurrent(
  value: string,
  config: CampbellStationConfig,
  nowMs: number = Date.now(),
): Reading {
  const expectation = tableExpectation(config, "current");
  const table = parseCampbellTable(value, expectation);
  const record = lastRecord(table, expectation.subject);
  const windAvgMps = kmhToMps(campbellSpeed(table, record, "Wind_Speed", expectation.subject));
  return {
    observedAt: naiveLocalToIso(record.time, config.timeZone, { nearMs: nowMs }),
    windAvgMps,
    windDirectionDeg: isCalm(windAvgMps)
      ? null
      : normalizeDegrees(campbellDirection(table, record, "WindDir", expectation.subject)),
    windGustMps: kmhToMps(campbellSpeed(table, record, "Wind_Gust", expectation.subject)),
    windLullMps: kmhToMps(campbellSpeed(table, record, "Wind_Lull", expectation.subject)),
    temperatureC: null,
    windChillC: null,
    conditions: null,
  };
}

export function parseCampbellHistory(
  value: string,
  config: CampbellStationConfig,
): { points: HistoryPoint[]; latestTemperatureC: number; latestWindChillC: number } {
  const expectation = tableExpectation(config, "history");
  const table = parseCampbellTable(value, expectation);
  const latest = lastRecord(table, expectation.subject);
  let previousMs: number | null = null;
  const points = table.records.map((record): HistoryPoint => {
    const windAvgMps = kmhToMps(campbellSpeed(table, record, "WS_kph_Avg", expectation.subject));
    const observedAt = naiveLocalToIso(record.time, config.timeZone, { afterMs: previousMs });
    previousMs = Date.parse(observedAt);
    return {
      observedAt,
      windAvgMps,
      windGustMps: kmhToMps(campbellSpeed(table, record, "WS_kph_Max", expectation.subject)),
      windLullMps: kmhToMps(campbellSpeed(table, record, "WS_kph_Min", expectation.subject)),
      windDirectionDeg: isCalm(windAvgMps)
        ? null
        : normalizeDegrees(campbellDirection(table, record, "WindDir", expectation.subject)),
      temperatureC: campbellNumber(table, record, "Temp", expectation.subject),
    };
  });
  return {
    points,
    latestTemperatureC: campbellNumber(table, latest, "Temp", expectation.subject),
    latestWindChillC: campbellNumber(table, latest, "Wind_Chill", expectation.subject),
  };
}

export function parseCampbellTable(
  value: string,
  expectation: CampbellTableExpectation,
): CampbellTable {
  const subject = expectation.subject;
  const data: unknown = JSON.parse(value);
  if (!isRecord(data) || data.more !== false) {
    throw new Error(`${subject} returned an incomplete response`);
  }
  const head = data.head;
  if (!isRecord(head) || !isRecord(head.environment)) {
    throw new Error(`${subject} returned no table definition`);
  }
  if (
    head.environment.station_name !== expectation.stationName ||
    head.environment.table_name !== expectation.tableName ||
    head.environment.interval !== expectation.intervalMs
  ) {
    throw new Error(`${subject} returned the wrong table`);
  }
  if (!Array.isArray(head.fields) || !Array.isArray(data.data)) {
    throw new Error(`${subject} returned invalid records`);
  }

  const fields = head.fields.map((field): CampbellField => {
    if (
      !isRecord(field) ||
      typeof field.name !== "string" ||
      typeof field.process !== "string" ||
      typeof field.type !== "string" ||
      typeof field.units !== "string"
    ) {
      throw new Error(`${subject} returned an invalid field`);
    }
    return { name: field.name, process: field.process, type: field.type, units: field.units };
  });
  const records = data.data.map((record): CampbellRecord => {
    if (!isRecord(record) || typeof record.time !== "string" || !Array.isArray(record.vals)) {
      throw new Error(`${subject} returned an invalid record`);
    }
    if (record.vals.length !== fields.length) {
      throw new Error(`${subject} record does not match its fields`);
    }
    return { time: record.time, vals: record.vals };
  });

  for (const contract of CAMPBELL_FIELD_CONTRACTS[expectation.role]) {
    const field = fields.find(({ name }) => name === contract.name);
    if (
      !field ||
      field.type !== contract.type ||
      field.process !== contract.process ||
      field.units !== contract.units
    ) {
      throw new Error(`${subject} field ${contract.name} changed`);
    }
  }

  return { fields, records };
}

function lastRecord(table: CampbellTable, subject: string): CampbellRecord {
  const record = table.records[table.records.length - 1];
  if (!record) throw new Error(`${subject} returned no readings`);
  return record;
}

function campbellNumber(
  table: CampbellTable,
  record: CampbellRecord,
  fieldName: string,
  subject: string,
): number {
  const index = table.fields.findIndex(({ name }) => name === fieldName);
  const value = index >= 0 ? record.vals[index] : null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${subject} is missing ${fieldName}`);
  }
  return value;
}

function campbellSpeed(
  table: CampbellTable,
  record: CampbellRecord,
  fieldName: string,
  subject: string,
): number {
  const value = campbellNumber(table, record, fieldName, subject);
  if (value < 0 || value > 500) throw new Error(`${subject} returned an invalid ${fieldName}`);
  return value;
}

function campbellDirection(
  table: CampbellTable,
  record: CampbellRecord,
  fieldName: string,
  subject: string,
): number {
  const value = campbellNumber(table, record, fieldName, subject);
  if (value < 0 || value > 360) {
    throw new Error(`${subject} returned an invalid ${fieldName}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const NAIVE_LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = zoneFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  zoneFormatters.set(timeZone, formatter);
  return formatter;
}

function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts: Record<string, string> = {};
  for (const { type, value } of zoneFormatter(timeZone).formatToParts(new Date(instantMs))) {
    parts[type] = value;
  }
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return representedAsUtc - instantMs;
}

function pickCandidate(
  candidates: number[],
  context: { afterMs?: number | null; nearMs?: number },
): number {
  const earliest = candidates[0] as number;
  if (candidates.length === 1) return earliest;
  if (context.afterMs != null) {
    const afterMs = context.afterMs;
    return (
      candidates.find((candidate) => candidate > afterMs) ??
      (candidates[candidates.length - 1] as number)
    );
  }
  if (context.nearMs != null) {
    const nearMs = context.nearMs;
    return candidates.reduce((best, candidate) =>
      Math.abs(candidate - nearMs) < Math.abs(best - nearMs) ? candidate : best,
    );
  }
  return earliest;
}

export function naiveLocalToIso(
  naive: string,
  timeZone: string,
  context: { afterMs?: number | null; nearMs?: number } = {},
): string {
  const match = NAIVE_LOCAL_TIME.exec(naive);
  if (!match) throw new Error(`invalid station-local time: ${naive}`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const target = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
  };
  const guess = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  const normalized = new Date(guess);
  if (
    normalized.getUTCFullYear() !== target.year ||
    normalized.getUTCMonth() !== target.month - 1 ||
    normalized.getUTCDate() !== target.day ||
    normalized.getUTCHours() !== target.hour ||
    normalized.getUTCMinutes() !== target.minute ||
    normalized.getUTCSeconds() !== target.second
  ) {
    throw new Error(`invalid station-local time: ${naive}`);
  }

  const offsets = [
    ...new Set([
      zoneOffsetMs(guess - DAY_MS, timeZone),
      zoneOffsetMs(guess, timeZone),
      zoneOffsetMs(guess + DAY_MS, timeZone),
    ]),
  ];
  const valid = offsets
    .map((offset) => guess - offset)
    .filter((candidate) => zoneOffsetMs(candidate, timeZone) === guess - candidate)
    .sort((a, b) => a - b);

  if (valid.length > 0) return new Date(pickCandidate(valid, context)).toISOString();

  /* Every probe stays on a whole second: Intl truncates sub-second parts, so
   * zoneOffsetMs is only exact there — and transitions sit on whole seconds. */
  const before = Math.min(...offsets);
  const after = Math.max(...offsets);
  let low = guess - after;
  let high = guess - before;
  const lowOffset = zoneOffsetMs(low, timeZone);
  while (high - low > 1_000) {
    const middle = low + Math.floor((high - low) / 2_000) * 1_000;
    if (zoneOffsetMs(middle, timeZone) === lowOffset) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return new Date(high).toISOString();
}
