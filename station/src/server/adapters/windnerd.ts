import { emptyConditions, type AirConditions, type HistoryPoint } from "../../contract.js";
import { isCalm, normalizeDegrees, pressureTendency, seaLevelPressureHpa } from "../../derive.js";
import { kmhToMps } from "@azohra/meteo.core";
import { windnerdStationUrl, type WindnerdStationConfig } from "../config.js";
import { defineStationAdapter, type StationAdapterOptions } from "../adapter.js";
import { fetchUpstreamText } from "../environment.js";

const WINDNERD_RECORDS_URL = "https://windnerd.net/api/records";
const RECORD_PERIOD_MINUTES = 1;
export const WINDNERD_RECORD_PERIODS_MINUTES = [1, 15, 60, 180] as const;
export type WindnerdRecordPeriodMinutes = (typeof WINDNERD_RECORD_PERIODS_MINUTES)[number];
const CACHE_TTL_SECONDS = 60;
const AGGREGATE_CACHE_TTL_SECONDS = 900;

const SENSOR_VALUE_LOOKBACK_MS = 15 * 60_000;

const STATION_PRESSURE_MIN_HPA = 300;
const STATION_PRESSURE_MAX_HPA = 1100;

export type WindnerdAdapterOptions = StationAdapterOptions & {
  recordsUrl?: string;
  recordPeriodMinutes?: WindnerdRecordPeriodMinutes;
  cacheTtlSeconds?: number;
};

export type WindnerdRecords = {
  averageSpeedKmh: number[];
  windDirectionDeg: number[];
  gustSpeedKmh: number[];
  lullSpeedKmh: number[];
  observedAt: string[];
  temperatureC: Array<number | null>;
  stationPressureHpa: Array<number | null>;
  utcOffsetMinutes: number | null;
};

const UTC_OFFSET_MIN_MINUTES = -720;
const UTC_OFFSET_MAX_MINUTES = 840;

export const loadWindnerdStation = defineStationAdapter<
  WindnerdStationConfig,
  WindnerdAdapterOptions
>({
  meta: (config) => ({
    id: config.id,
    name: config.name,
    sourceLabel: "WindNerd",
    pageUrl: config.pageUrl ?? windnerdStationUrl(config.stationKey),
    latitude: config.latitude ?? null,
    longitude: config.longitude ?? null,
    timeZone: config.timeZone ?? null,
    elevationM: config.elevationM ?? null,
    capabilities: {
      gustLull: true,
      temperature: config.hasTemperature,
      conditions: config.hasPressure,
      history: true,
    },
    samplingWindowSeconds: 60,
    recommendedPollSeconds: 60,
  }),
  load: async (config, { environment, historyHours, options }) => {
    const periodMinutes = options.recordPeriodMinutes ?? RECORD_PERIOD_MINUTES;
    if (!(WINDNERD_RECORD_PERIODS_MINUTES as readonly number[]).includes(periodMinutes)) {
      throw new Error(
        `WindNerd location ${config.locationId}: recordPeriodMinutes must be one of ` +
          `${WINDNERD_RECORD_PERIODS_MINUTES.join(", ")}, got ${periodMinutes}`,
      );
    }
    const now = environment.now();
    const url = new URL(options.recordsUrl ?? WINDNERD_RECORDS_URL);
    url.searchParams.set("location_id", String(config.locationId));
    url.searchParams.set("from", new Date(now.getTime() - historyHours * 3_600_000).toISOString());
    url.searchParams.set("to", now.toISOString());
    url.searchParams.set("period", String(periodMinutes));

    const records = parseWindnerdRecords(
      await fetchUpstreamText(environment, {
        url,
        cacheKey: `windnerd/${config.locationId}/${historyHours}/${periodMinutes}`,
        cacheTtlSeconds:
          options.cacheTtlSeconds ??
          (periodMinutes === RECORD_PERIOD_MINUTES
            ? CACHE_TTL_SECONDS
            : AGGREGATE_CACHE_TTL_SECONDS),
        subject: `WindNerd location ${config.locationId}`,
      }),
      config.locationId,
      config.hasPressure,
    );
    const points = windnerdHistoryPoints(records, config);
    const last = points[points.length - 1];
    if (!last) throw new Error(`WindNerd location ${config.locationId} returned no wind`);
    const lastMs = Date.parse(last.observedAt);

    return {
      reading: {
        observedAt: last.observedAt,
        windAvgMps: last.windAvgMps,
        windDirectionDeg: last.windDirectionDeg,
        windGustMps: last.windGustMps,
        windLullMps: last.windLullMps,
        temperatureC: config.hasTemperature
          ? (latestSensorValue(records.temperatureC, records.observedAt, lastMs)?.value ?? null)
          : null,
        windChillC: null,
        conditions: config.hasPressure ? windnerdConditions(records, points, config, lastMs) : null,
      },
      history: { periodMinutes, points },
    };
  },
});

export function windnerdHistoryPoints(
  records: WindnerdRecords,
  config: Pick<WindnerdStationConfig, "hasTemperature" | "hasPressure" | "elevationM">,
): HistoryPoint[] {
  const barometerElevationM = config.hasPressure ? (config.elevationM ?? null) : null;
  return records.observedAt.map((observedAt, index) => {
    const windAvgMps = kmhToMps(records.averageSpeedKmh[index] as number);
    const stationPressure = records.stationPressureHpa[index] ?? null;
    return {
      observedAt,
      windAvgMps,
      windGustMps: kmhToMps(records.gustSpeedKmh[index] as number),
      windLullMps: kmhToMps(records.lullSpeedKmh[index] as number),
      windDirectionDeg: isCalm(windAvgMps)
        ? null
        : normalizeDegrees(records.windDirectionDeg[index] as number),
      temperatureC: config.hasTemperature ? (records.temperatureC[index] ?? null) : null,
      seaLevelPressureHpa:
        barometerElevationM != null && stationPressure != null
          ? seaLevelPressureHpa(
              stationPressure,
              barometerElevationM,
              records.temperatureC[index] ?? null,
            )
          : null,
    };
  });
}

function windnerdConditions(
  records: WindnerdRecords,
  points: ReadonlyArray<HistoryPoint>,
  config: Pick<WindnerdStationConfig, "elevationM">,
  readingObservedAtMs: number,
): AirConditions {
  const fresh = latestSensorValue(
    records.stationPressureHpa,
    records.observedAt,
    readingObservedAtMs,
  );
  const reduced =
    fresh != null && config.elevationM != null
      ? seaLevelPressureHpa(
          fresh.value,
          config.elevationM,
          records.temperatureC[fresh.index] ?? null,
        )
      : null;
  return emptyConditions({
    pressureTrend: pressureTendency(points),
    seaLevelPressureHpa: reduced,
  });
}

export function parseWindnerdRecords(
  value: string,
  locationId: number,
  hasPressure = false,
): WindnerdRecords {
  const data: unknown = JSON.parse(value);
  if (!isRecord(data) || !isRecord(data.records)) {
    throw new Error(`WindNerd location ${locationId} returned no records`);
  }
  const { records } = data;
  const dates = records.date_utc;
  if (!Array.isArray(dates) || dates.some((date) => typeof date !== "string")) {
    throw new Error(`WindNerd location ${locationId} returned invalid record times`);
  }

  const fail = (name: string): never => {
    throw new Error(`WindNerd location ${locationId} returned an invalid ${name}`);
  };
  const speeds = (name: string) => numberSeries(records[name], dates.length, 0, 500, name, fail);
  return {
    averageSpeedKmh: speeds("wind_avg_1D"),
    windDirectionDeg: numberSeries(records.wind_dir, dates.length, 0, 360, "wind_dir", fail),
    gustSpeedKmh: speeds("wind_max"),
    lullSpeedKmh: speeds("wind_min"),
    observedAt: (dates as string[]).map((date) => recordTimeToIso(date, locationId)),
    temperatureC: nullableSeries(records.temperature_avg, dates.length, "temperature_avg", fail),
    stationPressureHpa: hasPressure
      ? nullableSeries(
          records.pressure_hpa_avg,
          dates.length,
          "pressure_hpa_avg",
          fail,
          STATION_PRESSURE_MIN_HPA,
          STATION_PRESSURE_MAX_HPA,
        )
      : dates.map(() => null),
    utcOffsetMinutes: parseUtcOffsetMinutes(records.time_offset, locationId),
  };
}

function parseUtcOffsetMinutes(value: unknown, locationId: number): number | null {
  if (!Array.isArray(value)) return null;
  const first = value.find(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry),
  );
  if (first == null) return null;
  if (first < UTC_OFFSET_MIN_MINUTES || first > UTC_OFFSET_MAX_MINUTES) {
    throw new Error(`WindNerd location ${locationId} returned an invalid time_offset`);
  }
  return first;
}

function latestSensorValue(
  series: ReadonlyArray<number | null>,
  observedAt: ReadonlyArray<string>,
  readingObservedAtMs: number,
): { value: number; index: number } | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index];
    if (value == null) continue;
    const recordMs = Date.parse(observedAt[index] as string);
    return readingObservedAtMs - recordMs <= SENSOR_VALUE_LOOKBACK_MS ? { value, index } : null;
  }
  return null;
}

function numberSeries(
  value: unknown,
  length: number,
  minimum: number,
  maximum: number,
  name: string,
  fail: (name: string) => never,
): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some(
      (entry) =>
        typeof entry !== "number" || !Number.isFinite(entry) || entry < minimum || entry > maximum,
    )
  ) {
    fail(name);
  }
  return value as number[];
}

function nullableSeries(
  value: unknown,
  length: number,
  name: string,
  fail: (name: string) => never,
  minimum = -Infinity,
  maximum = Infinity,
): Array<number | null> {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    value.some(
      (entry) =>
        entry != null &&
        (typeof entry !== "number" ||
          !Number.isFinite(entry) ||
          entry < minimum ||
          entry > maximum),
    )
  ) {
    fail(name);
  }
  return value as Array<number | null>;
}

function recordTimeToIso(value: string, locationId: number): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`WindNerd location ${locationId} returned an invalid record time`);
  }
  return new Date(parsed).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
