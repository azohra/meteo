import {
  emptyConditions,
  type AirConditions,
  type HistoryPoint,
  type LiveSamples,
  type Reading,
  type StationMeta,
  type StationTelemetry,
} from "../../contract.js";
import { isCalm, normalizeDegrees, pressureTendency, seaLevelPressureHpa } from "../../derive.js";
import { UpstreamError } from "@azohra/meteo.core";
import { sseEvents } from "../../sse.js";
import { windnerdStationUrl, type WindnerdStationConfig } from "../config.js";
import {
  defineStationAdapter,
  type StationAdapterResult,
  type StationAdapterOptions,
} from "../adapter.js";
import {
  coalesceUpstreamLoad,
  fetchUpstreamStream,
  fetchUpstreamText,
  logUpstreamFailure,
  type ResolvedEnvironment,
} from "../environment.js";

const WINDNERD_RECORDS_URL = "https://windnerd.net/api/records";
const WINDNERD_LIVE_URL = "https://windnerd.net/api/live-url";
const RECORD_PERIOD_MINUTES = 1;
export const WINDNERD_RECORD_PERIODS_MINUTES = [1, 15, 60, 180] as const;
export type WindnerdRecordPeriodMinutes = (typeof WINDNERD_RECORD_PERIODS_MINUTES)[number];
const CACHE_TTL_SECONDS = 60;
const AGGREGATE_CACHE_TTL_SECONDS = 900;
const LIVE_CACHE_TTL_SECONDS = 15;
export const WINDNERD_LIVE_RECOMMENDED_POLL_SECONDS = 15;
export const WINDNERD_LIVE_INIT_TIMEOUT_MS = 8_000;
export const WINDNERD_LIVE_SAMPLE_INTERVAL_SECONDS = 3;

const SENSOR_VALUE_LOOKBACK_MS = 15 * 60_000;

/* Every WindNerd speed — records series, digest blocks, live samples — is
 * m/s; the vendor's own dashboard multiplies by 3.6 for its km/h display
 * (verified 2026-08-14: location 240's hourly wind_avg_1D values times 3.6
 * reproduce the station page's km/h table exactly). */
const MAX_WIND_MPS = 140;
const STATION_PRESSURE_MIN_HPA = 300;
const STATION_PRESSURE_MAX_HPA = 1100;
const BATTERY_VOLTAGE_MIN = 0;
const BATTERY_VOLTAGE_MAX = 100;

export type WindnerdAdapterOptions = StationAdapterOptions & {
  recordsUrl?: string;
  liveUrl?: string;
  recordPeriodMinutes?: WindnerdRecordPeriodMinutes;
  cacheTtlSeconds?: number;
};

export type WindnerdRecords = {
  averageSpeedMps: number[];
  windDirectionDeg: number[];
  gustSpeedMps: number[];
  lullSpeedMps: number[];
  observedAt: string[];
  temperatureC: Array<number | null>;
  stationPressureHpa: Array<number | null>;
  utcOffsetMinutes: number | null;
};

const UTC_OFFSET_MIN_MINUTES = -720;
const UTC_OFFSET_MAX_MINUTES = 840;

export function windnerdStationMeta(config: WindnerdStationConfig): StationMeta {
  return {
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
      live: true,
      battery: config.hasBattery,
    },
    samplingWindowSeconds: 60,
    recommendedPollSeconds: 60,
  };
}

export const loadWindnerdStation = defineStationAdapter<
  WindnerdStationConfig,
  WindnerdAdapterOptions
>({
  meta: windnerdStationMeta,
  load: async (config, { environment, historyHours, mode, options }) => {
    if (mode === "current") {
      try {
        return await loadWindnerdLiveCurrent(config, environment, options);
      } catch (error) {
        /* The records road stays open when the live one closes — current
         * degrades to a one-minute record, never to unavailable-for-nothing. */
        logUpstreamFailure(
          environment,
          `${config.name} live current unavailable, serving records`,
          error,
          { station: config.id },
        );
      }
    }
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
    const windAvgMps = records.averageSpeedMps[index] as number;
    const stationPressure = records.stationPressureHpa[index] ?? null;
    return {
      observedAt,
      windAvgMps,
      windGustMps: records.gustSpeedMps[index] as number,
      windLullMps: records.lullSpeedMps[index] as number,
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

/* ── The live arm ──────────────────────────────────────────────────────────
 * live-url/<stationKey> is an SSE stream: one INIT frame (digest + a ring of
 * 3-second samples), then WIND_SAMPLES and LAST_DIGEST frames each minute.
 * Current mode reads only the INIT frame and hangs up; the open stream
 * belongs to openWindnerdLive. */

export type WindnerdLiveDigest = {
  observedAt: string;
  windAvgMps: number;
  gustMps: number | null;
  lullMps: number | null;
  windDirectionDeg: number;
  temperatureC: number | null;
  stationPressureHpa: number | null;
  batteryVoltage: number | null;
};

export type WindnerdLiveSampleRecord = {
  observedAt: string;
  speedMps: number;
  directionDeg: number;
};

export type WindnerdLiveInit = {
  digest: WindnerdLiveDigest;
  samples: WindnerdLiveSampleRecord[];
};

export function windnerdLiveStreamUrl(
  config: Pick<WindnerdStationConfig, "stationKey">,
  base: string = WINDNERD_LIVE_URL,
): URL {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return new URL(`${trimmed}/${encodeURIComponent(config.stationKey)}`);
}

export function parseWindnerdLiveInit(value: string, locationId: number): WindnerdLiveInit {
  let data: unknown;
  try {
    data = JSON.parse(value);
  } catch {
    throw new Error(`WindNerd location ${locationId} returned an unparseable live frame`);
  }
  if (!isRecord(data) || data.type !== "INIT") {
    throw new Error(`WindNerd location ${locationId} returned no live init frame`);
  }
  return {
    digest: parseWindnerdLiveDigest(data.digest, locationId),
    samples: parseWindnerdLiveSampleRecords(data.samples, locationId),
  };
}

/* Accepts both homes of the digest record: the INIT frame's digest field and
 * a LAST_DIGEST frame itself. */
export function parseWindnerdLiveDigest(value: unknown, locationId: number): WindnerdLiveDigest {
  const fail = (name: string): never => {
    throw new Error(`WindNerd location ${locationId} returned an invalid live ${name}`);
  };
  if (!isRecord(value) || !isRecord(value.recent)) fail("digest");
  const digest = value as Record<string, unknown>;
  const recent = digest.recent as Record<string, unknown>;

  const rangeOrNull = (entry: unknown, minimum: number, maximum: number, name: string) => {
    if (entry == null) return null;
    if (
      typeof entry !== "number" ||
      !Number.isFinite(entry) ||
      entry < minimum ||
      entry > maximum
    ) {
      fail(name);
    }
    return entry as number;
  };

  if (typeof recent.date_utc !== "string") fail("digest time");
  const observedAt = recordTimeToIso(recent.date_utc as string, locationId);

  /* The freshest complete minute carries the scalar average and gust/lull;
   * the recent block alone carries only the vector average. */
  const minutes = Array.isArray(digest.last_10mn_by_1mn) ? digest.last_10mn_by_1mn : [];
  const lastMinute: unknown = minutes.length > 0 ? minutes[minutes.length - 1] : null;
  const wind = isRecord(lastMinute) ? lastMinute : recent;

  const windAvgMps =
    rangeOrNull(wind.wind_avg_1D, 0, MAX_WIND_MPS, "wind_avg_1D") ??
    rangeOrNull(wind.wind_avg_2D, 0, MAX_WIND_MPS, "wind_avg_2D") ??
    fail("wind average");
  const windDirectionDeg = rangeOrNull(wind.wind_dir, 0, 360, "wind_dir") ?? fail("wind_dir");

  return {
    observedAt,
    windAvgMps,
    gustMps: rangeOrNull(wind.wind_max, 0, MAX_WIND_MPS, "wind_max"),
    lullMps: rangeOrNull(wind.wind_min, 0, MAX_WIND_MPS, "wind_min"),
    windDirectionDeg,
    temperatureC: rangeOrNull(recent.temperature, -Infinity, Infinity, "temperature"),
    stationPressureHpa: rangeOrNull(
      recent.pressure_hpa,
      STATION_PRESSURE_MIN_HPA,
      STATION_PRESSURE_MAX_HPA,
      "pressure_hpa",
    ),
    batteryVoltage: rangeOrNull(
      recent.voltage,
      BATTERY_VOLTAGE_MIN,
      BATTERY_VOLTAGE_MAX,
      "voltage",
    ),
  };
}

export function parseWindnerdLiveSampleRecords(
  value: unknown,
  locationId: number,
): WindnerdLiveSampleRecord[] {
  const fail = (name: string): never => {
    throw new Error(`WindNerd location ${locationId} returned an invalid live ${name}`);
  };
  if (!Array.isArray(value)) fail("samples");
  const records = (value as unknown[])
    /* The upstream ring buffer keeps empty slots as nulls; skip them. */
    .filter((entry) => entry != null)
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.ts !== "string") fail("sample");
      const record = entry as Record<string, unknown>;
      const speedMps = record.sp;
      const directionDeg = record.dir;
      if (
        typeof speedMps !== "number" ||
        !Number.isFinite(speedMps) ||
        speedMps < 0 ||
        speedMps > MAX_WIND_MPS
      ) {
        fail("sample sp");
      }
      if (
        typeof directionDeg !== "number" ||
        !Number.isFinite(directionDeg) ||
        directionDeg < 0 ||
        directionDeg > 360
      ) {
        fail("sample dir");
      }
      return {
        observedAt: recordTimeToIso(record.ts as string, locationId),
        speedMps: speedMps as number,
        directionDeg: directionDeg as number,
      };
    });
  return records.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}

export function windnerdLiveReading(
  digest: WindnerdLiveDigest,
  config: Pick<
    WindnerdStationConfig,
    "hasTemperature" | "hasPressure" | "hasBattery" | "elevationM"
  >,
): { reading: Reading; telemetry: StationTelemetry | null } {
  const windAvgMps = digest.windAvgMps;
  return {
    reading: {
      observedAt: digest.observedAt,
      windAvgMps,
      windDirectionDeg: isCalm(windAvgMps) ? null : normalizeDegrees(digest.windDirectionDeg),
      windGustMps: digest.gustMps,
      windLullMps: digest.lullMps,
      temperatureC: config.hasTemperature ? digest.temperatureC : null,
      windChillC: null,
      conditions: config.hasPressure
        ? emptyConditions({
            /* No minute series rides the live digest, so the trend stays null. */
            seaLevelPressureHpa:
              digest.stationPressureHpa != null && config.elevationM != null
                ? seaLevelPressureHpa(
                    digest.stationPressureHpa,
                    config.elevationM,
                    digest.temperatureC,
                  )
                : null,
          })
        : null,
    },
    telemetry: config.hasBattery ? { batteryVoltage: digest.batteryVoltage } : null,
  };
}

export function windnerdLiveSamples(records: WindnerdLiveSampleRecord[]): LiveSamples {
  return {
    intervalSeconds: WINDNERD_LIVE_SAMPLE_INTERVAL_SECONDS,
    points: records.map((record) => {
      const windMps = record.speedMps;
      return {
        observedAt: record.observedAt,
        windMps,
        windDirectionDeg: isCalm(windMps) ? null : normalizeDegrees(record.directionDeg),
      };
    }),
  };
}

async function loadWindnerdLiveCurrent(
  config: WindnerdStationConfig,
  environment: ResolvedEnvironment,
  options: WindnerdAdapterOptions,
): Promise<StationAdapterResult> {
  const text = await fetchWindnerdLiveInitText(config, environment, options);
  const init = parseWindnerdLiveInit(text, config.locationId);
  const { reading, telemetry } = windnerdLiveReading(init.digest, config);
  return {
    reading,
    history: null,
    telemetry,
    samples: windnerdLiveSamples(init.samples),
    meta: { recommendedPollSeconds: WINDNERD_LIVE_RECOMMENDED_POLL_SECONDS },
  };
}

async function fetchWindnerdLiveInitText(
  config: WindnerdStationConfig,
  environment: ResolvedEnvironment,
  options: WindnerdAdapterOptions,
): Promise<string> {
  const cacheKey = `windnerd/live/${config.locationId}`;
  const cached = await environment.cache.get(cacheKey);
  if (cached != null) return cached;
  return coalesceUpstreamLoad(environment.cache, cacheKey, async () => {
    const subject = `WindNerd location ${config.locationId} live stream`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WINDNERD_LIVE_INIT_TIMEOUT_MS);
    try {
      const response = await fetchUpstreamStream(environment, {
        url: windnerdLiveStreamUrl(config, options.liveUrl),
        subject,
        signal: controller.signal,
      });
      const body = response.body as ReadableStream<Uint8Array>;
      for await (const event of sseEvents(body, { signal: controller.signal })) {
        if (event.event !== "message") continue;
        let type: unknown;
        try {
          const frame: unknown = JSON.parse(event.data);
          type = isRecord(frame) ? frame.type : undefined;
        } catch {
          continue; /* pre-init noise is upstream's business; the init frame is ours */
        }
        if (type === "INIT") {
          await environment.cache.put(cacheKey, event.data, LIVE_CACHE_TTL_SECONDS);
          return event.data;
        }
      }
      throw new UpstreamError(`${subject} ended before its init frame`);
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof UpstreamError)) {
        throw new UpstreamError(`${subject} timed out`, "timeout");
      }
      throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
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
  const speeds = (name: string) =>
    numberSeries(records[name], dates.length, 0, MAX_WIND_MPS, name, fail);
  return {
    averageSpeedMps: speeds("wind_avg_1D"),
    windDirectionDeg: numberSeries(records.wind_dir, dates.length, 0, 360, "wind_dir", fail),
    gustSpeedMps: speeds("wind_max"),
    lullSpeedMps: speeds("wind_min"),
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
