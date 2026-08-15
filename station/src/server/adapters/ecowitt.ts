import type { Reading, StationTelemetry } from "../../contract.js";
import { emptyConditions } from "../../contract.js";
import { isCalm, normalizeDegrees, seaLevelPressureHpa } from "../../derive.js";
import { UpstreamError, plausibleWindMps } from "@azohra/meteo.core";
import type { EcowittStationConfig } from "../config.js";
import { defineStationAdapter, type StationAdapterOptions } from "../adapter.js";
import { fetchUpstreamText } from "../environment.js";

const ECOWITT_REAL_TIME_URL = "https://api.ecowitt.net/api/v3/device/real_time";
const CACHE_TTL_SECONDS = 60;

/* The field groups this adapter reads; anything else the account's other
 * sensors publish is left off the request entirely. */
const ECOWITT_CALL_BACK = "outdoor,wind,pressure,rainfall,rainfall_piezo,solar_and_uvi,battery";

/* Every request pins SI units explicitly, so the payload never needs unit
 * parsing: °C, hPa, m/s, mm, W/m². The defaults are imperial. */
const ECOWITT_UNIT_PARAMS = {
  temp_unitid: "1",
  pressure_unitid: "3",
  wind_speed_unitid: "6",
  rainfall_unitid: "12",
  solar_irradiance_unitid: "16",
} as const;

export type EcowittAdapterOptions = StationAdapterOptions & {
  realTimeUrl?: string;
};

export type EcowittObservation = {
  reading: Reading;
  telemetry: StationTelemetry | null;
};

export const loadEcowittStation = defineStationAdapter<EcowittStationConfig, EcowittAdapterOptions>(
  {
    meta: (config) => ({
      id: config.id,
      name: config.name,
      sourceLabel: "Ecowitt",
      pageUrl: config.pageUrl ?? null,
      latitude: config.latitude ?? null,
      longitude: config.longitude ?? null,
      timeZone: config.timeZone ?? null,
      elevationM: config.elevationM ?? null,
      capabilities: {
        gustLull: true,
        temperature: true,
        conditions: true,
        history: false,
        battery: config.hasBattery,
      },
      samplingWindowSeconds: null,
      recommendedPollSeconds: 60,
    }),
    load: async (config, { environment, options }) => {
      const url = new URL(options.realTimeUrl ?? ECOWITT_REAL_TIME_URL);
      url.searchParams.set("application_key", config.applicationKey);
      url.searchParams.set("api_key", config.apiKey);
      url.searchParams.set("mac", config.mac);
      url.searchParams.set("call_back", ECOWITT_CALL_BACK);
      for (const [name, value] of Object.entries(ECOWITT_UNIT_PARAMS)) {
        url.searchParams.set(name, value);
      }

      const observation = parseEcowittRealTime(
        await fetchUpstreamText(environment, {
          url,
          /* Keyed on the device alone: credentials must never leak into a shared cache. */
          cacheKey: `ecowitt/${config.mac}`,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          subject: `Ecowitt device ${config.mac}`,
        }),
        config,
      );

      return {
        reading: observation.reading,
        history: null,
        telemetry: config.hasBattery ? observation.telemetry : null,
      };
    },
  },
);

export function parseEcowittRealTime(
  value: string,
  config: Pick<EcowittStationConfig, "mac" | "elevationM">,
): EcowittObservation {
  const envelope: unknown = JSON.parse(value);
  if (!isRecord(envelope) || typeof envelope.code !== "number") {
    throw new Error("Ecowitt returned no response envelope");
  }
  if (envelope.code !== 0) {
    const message = `Ecowitt refused the request: ${String(envelope.msg)} (code ${envelope.code})`;
    /* -1 is "system busy", 45001 is "over the limit" — both are try-later. */
    throw envelope.code === -1 || envelope.code === 45001
      ? new UpstreamError(message, "rate_limited")
      : new UpstreamError(message);
  }

  const data = isRecord(envelope.data) ? envelope.data : {};
  const wind = section(data, "wind");
  if (!wind) {
    /* code 0 with no wind group is a device the cloud has nothing fresh for
     * (real_time only serves reports from the last two hours). */
    throw new UpstreamError(`Ecowitt device ${config.mac} has not reported recently`);
  }

  const observedAtSeconds = leafTime(wind, "wind_speed");
  const windAvgMps = windSpeedMps(numberLeaf(wind, "wind_speed"));
  const windDirectionDeg = directionDegrees(numberLeaf(wind, "wind_direction"));

  const outdoor = section(data, "outdoor");
  const pressure = section(data, "pressure");
  const solar = section(data, "solar_and_uvi");
  /* A WS90 rains through its piezo group; a tipping bucket fills `rainfall`.
   * When both sensors exist the piezo group is preferred. */
  const rain = section(data, "rainfall_piezo") ?? section(data, "rainfall");

  const temperatureC = outdoor ? nullableNumberLeaf(outdoor, "temperature") : null;
  const stationPressureHpa = pressure
    ? nullableNumberLeaf(pressure, "absolute", positiveNumber)
    : null;

  const conditions = emptyConditions({
    dewPointC: outdoor ? nullableNumberLeaf(outdoor, "dew_point") : null,
    relativeHumidityPercent: outdoor ? nullableNumberLeaf(outdoor, "humidity", percentage) : null,
    seaLevelPressureHpa:
      stationPressureHpa != null && config.elevationM != null
        ? seaLevelPressureHpa(stationPressureHpa, config.elevationM, temperatureC)
        : null,
    precipitationRateMmPerHour: rain
      ? nullableNumberLeaf(rain, "rain_rate", nonnegativeNumber)
      : null,
    precipitationTodayMm: rain ? nullableNumberLeaf(rain, "daily", nonnegativeNumber) : null,
    solarRadiationWm2: solar ? nullableNumberLeaf(solar, "solar", nonnegativeNumber) : null,
    uvIndex: solar ? nullableNumberLeaf(solar, "uvi", nonnegativeNumber) : null,
  });

  const battery = section(data, "battery");
  const telemetry: StationTelemetry | null = battery
    ? { batteryVoltage: nullableNumberLeaf(battery, "haptic_array_battery", positiveNumber) }
    : null;

  return {
    telemetry,
    reading: {
      observedAt: new Date(observedAtSeconds * 1_000).toISOString(),
      windAvgMps,
      windDirectionDeg: isCalm(windAvgMps) ? null : normalizeDegrees(windDirectionDeg),
      windGustMps: nullableNumberLeaf(wind, "wind_gust", windSpeedMps),
      /* Ecowitt reports no lull; absence travels as null, never zero. */
      windLullMps: null,
      temperatureC,
      /* `outdoor.feels_like` is a blended comfort index, not wind chill. */
      windChillC: null,
      conditions,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(data: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const parsed = data[name];
  return isRecord(parsed) && Object.keys(parsed).length > 0 ? parsed : null;
}

/* Every leaf is { time, unit, value } with the number serialized as a string. */
function leaf(group: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const parsed = group[name];
  return isRecord(parsed) ? parsed : null;
}

function leafNumber(entry: Record<string, unknown>, name: string, field: string): number {
  const raw = entry[field];
  const parsed =
    typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Ecowitt sent a non-numeric ${name}.${field}`);
  return parsed;
}

function numberLeaf(
  group: Record<string, unknown>,
  name: string,
  transform: (value: number) => number = (parsed) => parsed,
): number {
  const entry = leaf(group, name);
  if (!entry) throw new Error(`Ecowitt is missing ${name}`);
  return transform(leafNumber(entry, name, "value"));
}

function nullableNumberLeaf(
  group: Record<string, unknown>,
  name: string,
  transform: (value: number) => number = (parsed) => parsed,
): number | null {
  return leaf(group, name) == null ? null : numberLeaf(group, name, transform);
}

function leafTime(group: Record<string, unknown>, name: string): number {
  const entry = leaf(group, name);
  if (!entry) throw new Error(`Ecowitt is missing ${name}`);
  return nonnegativeNumber(leafNumber(entry, name, "time"));
}

function nonnegativeNumber(value: number): number {
  if (value < 0) throw new Error("Ecowitt returned a negative value");
  return value;
}

function positiveNumber(value: number): number {
  if (value <= 0) throw new Error("Ecowitt returned a non-positive value");
  return value;
}

function percentage(value: number): number {
  if (value < 0 || value > 100) throw new Error("Ecowitt returned an invalid percentage");
  return value;
}

function windSpeedMps(value: number): number {
  return plausibleWindMps(value, "Ecowitt");
}

function directionDegrees(value: number): number {
  if (value < 0 || value > 360) {
    throw new Error("Ecowitt returned an invalid wind direction");
  }
  return value;
}
