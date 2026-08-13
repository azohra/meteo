import type { AirConditions, Reading } from "../../contract.js";
import { isCalm, normalizeDegrees } from "../../derive.js";
import { plausibleWindMps } from "@azohra/meteo.core";
import type { TempestStationConfig } from "../config.js";
import { defineStationAdapter, type StationAdapterOptions } from "../adapter.js";
import { fetchUpstreamText } from "../environment.js";

const TEMPEST_OBSERVATIONS_URL = "https://swd.weatherflow.com/swd/rest/observations/station";
const CACHE_TTL_SECONDS = 60;

export type TempestAdapterOptions = StationAdapterOptions & {
  observationsUrl?: string;
};

export type TempestObservation = {
  reading: Reading;
  elevationM: number | null;
  latitude: number | null;
  longitude: number | null;
};

export const loadTempestStation = defineStationAdapter<TempestStationConfig, TempestAdapterOptions>(
  {
    meta: (config) => ({
      id: config.id,
      name: config.name,
      sourceLabel: "Tempest",
      pageUrl: config.pageUrl ?? `https://tempestwx.com/station/${config.stationId}`,
      latitude: config.latitude ?? null,
      longitude: config.longitude ?? null,
      timeZone: config.timeZone ?? null,
      elevationM: config.elevationM ?? null,
      capabilities: { gustLull: true, temperature: true, conditions: true, history: false },
      samplingWindowSeconds: 60,
      recommendedPollSeconds: 60,
    }),
    load: async (config, { environment, options }) => {
      const url = new URL(
        `${options.observationsUrl ?? TEMPEST_OBSERVATIONS_URL}/${config.stationId}`,
      );
      url.searchParams.set("token", config.token);

      const observation = parseTempestWind(
        await fetchUpstreamText(environment, {
          url,
          /* Keyed without the token: a credential must never leak into a shared cache. */
          cacheKey: `tempest/${config.stationId}`,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
          subject: `Tempest station ${config.stationId}`,
        }),
        config.stationId,
      );

      return {
        reading: observation.reading,
        history: null,
        meta: {
          elevationM: observation.elevationM ?? config.elevationM ?? null,
          latitude: observation.latitude ?? config.latitude ?? null,
          longitude: observation.longitude ?? config.longitude ?? null,
        },
      };
    },
  },
);

export function parseTempestWind(value: string, expectedStationId: number): TempestObservation {
  const data: unknown = JSON.parse(value);
  if (!isRecord(data) || data.station_id !== expectedStationId) {
    throw new Error("Tempest returned the wrong station");
  }
  const observation = Array.isArray(data.obs) ? data.obs[0] : null;
  if (!isRecord(observation)) throw new Error("Tempest returned no observation");

  const timestamp = numberField(observation, "timestamp");
  const windAvgMps = windSpeedMps(numberField(observation, "wind_avg"));
  const windDirectionDeg = directionDegrees(numberField(observation, "wind_direction"));

  const conditions: AirConditions = {
    dewPointC: nullableNumberField(observation, "dew_point"),
    lastLightningStrikeAt: nullableEpochField(observation, "lightning_strike_last_epoch"),
    lastLightningStrikeDistanceKm: nullableNumberField(
      observation,
      "lightning_strike_last_distance",
      nonnegativeNumber,
    ),
    lightningStrikeCountLastHour: nullableNumberField(
      observation,
      "lightning_strike_count_last_1hr",
      nonnegativeInteger,
    ),
    precipitationMinutesToday: nullableNumberField(
      observation,
      "precip_minutes_local_day",
      nonnegativeInteger,
    ),
    precipitationRateMmPerHour: nullableNumberField(
      observation,
      "precip",
      (parsed) => nonnegativeNumber(parsed) * 60,
    ),
    precipitationTodayMm: nullableNumberField(
      observation,
      "precip_accum_local_day",
      nonnegativeNumber,
    ),
    pressureTrend: nullablePressureTrend(observation, "pressure_trend"),
    relativeHumidityPercent: nullableNumberField(observation, "relative_humidity", percentage),
    seaLevelPressureHpa: nullableNumberField(observation, "sea_level_pressure", positiveNumber),
    solarRadiationWm2: nullableNumberField(observation, "solar_radiation", nonnegativeNumber),
    uvIndex: nullableNumberField(observation, "uv", nonnegativeNumber),
  };

  return {
    elevationM: nullableNumberField(data, "elevation"),
    latitude: nullableNumberField(data, "latitude", latitudeDegrees),
    longitude: nullableNumberField(data, "longitude", longitudeDegrees),
    reading: {
      observedAt: new Date(timestamp * 1_000).toISOString(),
      windAvgMps,
      windDirectionDeg: isCalm(windAvgMps) ? null : normalizeDegrees(windDirectionDeg),
      windGustMps: windSpeedMps(numberField(observation, "wind_gust")),
      windLullMps: nullableNumberField(observation, "wind_lull", windSpeedMps),
      temperatureC: numberField(observation, "air_temperature"),
      windChillC: nullableNumberField(observation, "wind_chill"),
      conditions,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberField(value: Record<string, unknown>, name: string): number {
  const parsed = value[name];
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`Tempest is missing ${name}`);
  }
  return parsed;
}

function nullableNumberField(
  value: Record<string, unknown>,
  name: string,
  transform: (value: number) => number = (parsed) => parsed,
): number | null {
  return value[name] == null ? null : transform(numberField(value, name));
}

function nullableEpochField(value: Record<string, unknown>, name: string): string | null {
  return value[name] == null
    ? null
    : new Date(nonnegativeInteger(numberField(value, name)) * 1_000).toISOString();
}

function nullablePressureTrend(
  value: Record<string, unknown>,
  name: string,
): AirConditions["pressureTrend"] {
  const parsed = value[name];
  if (parsed == null) return null;
  if (parsed === "falling" || parsed === "rising" || parsed === "steady" || parsed === "unknown") {
    return parsed;
  }
  throw new Error("Tempest returned an invalid pressure trend");
}

function nonnegativeNumber(value: number): number {
  if (value < 0) throw new Error("Tempest returned a negative value");
  return value;
}

function positiveNumber(value: number): number {
  if (value <= 0) throw new Error("Tempest returned a non-positive value");
  return value;
}

function nonnegativeInteger(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Tempest returned an invalid count");
  }
  return value;
}

function percentage(value: number): number {
  if (value < 0 || value > 100) throw new Error("Tempest returned an invalid percentage");
  return value;
}

function windSpeedMps(value: number): number {
  return plausibleWindMps(value, "Tempest");
}

function directionDegrees(value: number): number {
  if (value < 0 || value > 360) {
    throw new Error("Tempest returned an invalid wind direction");
  }
  return value;
}

function latitudeDegrees(value: number): number {
  if (value < -90 || value > 90) throw new Error("Tempest returned an invalid latitude");
  return value;
}

function longitudeDegrees(value: number): number {
  if (value < -180 || value > 180) throw new Error("Tempest returned an invalid longitude");
  return value === 180 ? -180 : value;
}
