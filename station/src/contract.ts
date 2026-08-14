import { z } from "zod";
import { UPSTREAM_FAILURE_REASONS } from "@azohra/meteo.core";

export const STATION_SCHEMA_VERSION = 2;

export const STATION_WIRE_V1_RENAMES: Record<string, string> = {
  averageMps: "windAvgMps",
  gustMps: "windGustMps",
  lullMps: "windLullMps",
  directionDeg: "windDirectionDeg",
};

export const UNAVAILABLE_REASONS = [...UPSTREAM_FAILURE_REASONS, "not_configured"] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

const isoTime = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "not an ISO timestamp",
  })
  .meta({ format: "date-time" });

const speedMps = z.number().finite().min(0);
const windDirectionDeg = z.number().finite().min(0).lt(360);

/* Extended air data; null means "not reported here", never a missing sensor. */
export const airConditionsSchema = z
  .object({
    dewPointC: z.number().finite().nullable(),
    lastLightningStrikeAt: isoTime.nullable(),
    lastLightningStrikeDistanceKm: z.number().finite().nullable(),
    lightningStrikeCountLastHour: z.number().finite().nullable(),
    precipitationMinutesToday: z.number().finite().nullable(),
    precipitationRateMmPerHour: z.number().finite().nullable(),
    precipitationTodayMm: z.number().finite().nullable(),
    pressureTrend: z.enum(["falling", "rising", "steady", "unknown"]).nullable(),
    relativeHumidityPercent: z.number().finite().nullable(),
    seaLevelPressureHpa: z.number().finite().nullable(),
    solarRadiationWm2: z.number().finite().nullable(),
    uvIndex: z.number().finite().min(0).nullable(),
  })
  .describe(
    "Extended air data. null means 'not reported here' — it does not " +
      "distinguish a missing sensor from a dark one; the station-level " +
      "conditions capability gates whether a client allocates UI structure.",
  )
  .meta({ id: "AirConditions" });
export type AirConditions = z.infer<typeof airConditionsSchema>;

/* Device health, not weather — a sibling of the reading so air data stays air data. */
export const telemetrySchema = z
  .object({
    batteryVoltage: z
      .number()
      .finite()
      .nullable()
      .describe("Station supply volts. null means 'not reported here', never a dead battery."),
  })
  .describe(
    "Device telemetry. The station-level battery capability gates whether " +
      "a client allocates UI structure; a dark sensor keeps its structure " +
      "and reports null.",
  )
  .meta({ id: "StationTelemetry" });
export type StationTelemetry = z.infer<typeof telemetrySchema>;

export const readingSchema = z
  .object({
    observedAt: isoTime,
    /* The reading is itself a windowed average; samplingWindowSeconds says over what. */
    windAvgMps: speedMps.describe(
      "Wind speed in m/s, averaged over samplingWindowSeconds. " + "Absence is null, never zero.",
    ),
    windDirectionDeg: windDirectionDeg
      .nullable()
      .describe(
        "Bearing the wind blows FROM, degrees [0, 360). null exactly when " +
          "calm (windAvgMps below the WMO 0.5 m/s threshold) — calm carries " +
          "no direction; a null on a blowing reading is a dead vane.",
      ),
    windGustMps: speedMps.nullable().describe("Peak m/s within the sampling window; null ≠ zero."),
    windLullMps: speedMps
      .nullable()
      .describe("Minimum m/s within the sampling window; null ≠ zero."),
    temperatureC: z.number().finite().nullable(),
    windChillC: z.number().finite().nullable(),
    conditions: airConditionsSchema.nullable(),
  })
  .meta({ id: "Reading" });
export type Reading = z.infer<typeof readingSchema>;

export const historyPointSchema = z
  .object({
    observedAt: isoTime,
    windAvgMps: speedMps.describe("Mean m/s over the record's period."),
    windGustMps: speedMps.nullable(),
    windLullMps: speedMps.nullable(),
    windDirectionDeg: windDirectionDeg
      .nullable()
      .describe("Degrees FROM; null exactly when the period was calm (below 0.5 m/s)."),
    temperatureC: z.number().finite().nullable(),
    seaLevelPressureHpa: z.number().finite().positive().nullish(),
  })
  .meta({ id: "HistoryPoint" });
export type HistoryPoint = z.infer<typeof historyPointSchema>;

export const historySchema = z
  .object({
    periodMinutes: z
      .number()
      .finite()
      .positive()
      .describe(
        "Minutes each point covers. Wind run, vane thinning, and dropout " +
          "detection are functions of it.",
      ),
    points: z
      .array(historyPointSchema)
      .describe("A dropout is an ABSENT record, never a zeroed one — gaps carry no points."),
  })
  .meta({ id: "History" });
export type History = z.infer<typeof historySchema>;

export const liveSampleSchema = z
  .object({
    observedAt: isoTime,
    windMps: speedMps.describe(
      "Instantaneous m/s — a single anemometer sample, not a period mean.",
    ),
    windDirectionDeg: windDirectionDeg
      .nullable()
      .describe("Degrees FROM; null exactly when calm (below 0.5 m/s)."),
  })
  .meta({ id: "LiveSample" });
export type LiveSample = z.infer<typeof liveSampleSchema>;

export const liveSamplesSchema = z
  .object({
    intervalSeconds: z.number().finite().positive().describe("Seconds between samples."),
    points: z
      .array(liveSampleSchema)
      .describe("Oldest first. A dropout is an ABSENT sample, never a zeroed one."),
  })
  .meta({ id: "LiveSamples" });
export type LiveSamples = z.infer<typeof liveSamplesSchema>;

/* New capability keys must arrive .nullish() (null = undeclared = false); a
 * required boolean would brick every already-published document. */
export const capabilitiesSchema = z
  .object({
    gustLull: z.boolean(),
    temperature: z.boolean(),
    conditions: z.boolean(),
    history: z.boolean(),
    live: z
      .boolean()
      .nullish()
      .describe("The station has a live sample stream; absent or null reads as false."),
    battery: z
      .boolean()
      .nullish()
      .describe("The station reports battery telemetry; absent or null reads as false."),
  })
  .describe(
    "Declared from what the hardware carries, never inferred from data. " +
      "Capabilities gate client UI structure; a dark sensor keeps its " +
      "structure and reports null.",
  )
  .meta({ id: "StationCapabilities" });
export type StationCapabilities = z.infer<typeof capabilitiesSchema>;

const stationMetaShape = {
  id: z.string().min(1),
  name: z.string().min(1),
  sourceLabel: z.string(),
  pageUrl: z.string().nullable(),
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).lt(180).nullable(),
  timeZone: z.string().min(1).nullable(),
  elevationM: z.number().finite().nullable(),
  capabilities: capabilitiesSchema,
  samplingWindowSeconds: z.number().finite().positive().nullable(),
  recommendedPollSeconds: z.number().finite().positive(),
};

export const stationMetaSchema = z.object(stationMetaShape);
export type StationMeta = z.infer<typeof stationMetaSchema>;

export const stationSchema = z
  .discriminatedUnion("status", [
    z.object({
      ...stationMetaShape,
      status: z.literal("ok"),
      reading: readingSchema,
      history: historySchema.nullable(),
      telemetry: telemetrySchema.nullish(),
      samples: liveSamplesSchema.nullish(),
    }),
    z.object({
      ...stationMetaShape,
      status: z.literal("unavailable"),
      reason: z.enum(UNAVAILABLE_REASONS),
      reading: z.null(),
      history: z.null(),
    }),
  ])
  .meta({ id: "Station" });
export type Station = z.infer<typeof stationSchema>;

export const stationFeedSchema = z.object({
  schemaVersion: z.literal(STATION_SCHEMA_VERSION),
  servedAt: isoTime.describe(
    "The server clock at response time. Freshness is judged client-side " +
      "against this anchor, so a wrong client clock cannot declare a live " +
      "station stale.",
  ),
  primaryStationId: z.string().nullable(),
  stations: z.array(stationSchema),
});
export type StationFeed = z.infer<typeof stationFeedSchema>;

export const stationCurrentSchema = z.object({
  schemaVersion: z.literal(STATION_SCHEMA_VERSION),
  servedAt: isoTime,
  station: stationSchema,
});
export type StationCurrent = z.infer<typeof stationCurrentSchema>;

/* One frame per SSE data event on the /live route. The init frame reuses the
 * Station shape (history null) so a live client needs one decoder; the
 * unavailable frame is terminal — the stream closes after it. */
export const stationLiveFrameSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("init"),
      schemaVersion: z.literal(STATION_SCHEMA_VERSION),
      servedAt: isoTime,
      station: stationSchema,
    }),
    z.object({
      type: z.literal("samples"),
      stationId: z.string().min(1),
      samples: liveSamplesSchema,
    }),
    z.object({
      type: z.literal("reading"),
      stationId: z.string().min(1),
      servedAt: isoTime,
      reading: readingSchema,
      telemetry: telemetrySchema.nullable(),
    }),
    z.object({
      type: z.literal("ping"),
      servedAt: isoTime,
    }),
    z.object({
      type: z.literal("unavailable"),
      stationId: z.string().min(1),
      reason: z.enum(UNAVAILABLE_REASONS),
    }),
  ])
  .meta({ id: "StationLiveFrame" });
export type StationLiveFrame = z.infer<typeof stationLiveFrameSchema>;

export function parseStationFeed(value: unknown): StationFeed | null {
  const result = stationFeedSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseStationFeedJson(text: string): StationFeed | null {
  try {
    return parseStationFeed(JSON.parse(text));
  } catch {
    return null;
  }
}

export function parseStationCurrent(value: unknown): StationCurrent | null {
  const result = stationCurrentSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseStationCurrentJson(text: string): StationCurrent | null {
  try {
    return parseStationCurrent(JSON.parse(text));
  } catch {
    return null;
  }
}

export function parseStationLiveFrame(value: unknown): StationLiveFrame | null {
  const result = stationLiveFrameSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseStationLiveFrameJson(text: string): StationLiveFrame | null {
  try {
    return parseStationLiveFrame(JSON.parse(text));
  } catch {
    return null;
  }
}

export function emptyConditions(overrides: Partial<AirConditions> = {}): AirConditions {
  return {
    dewPointC: null,
    lastLightningStrikeAt: null,
    lastLightningStrikeDistanceKm: null,
    lightningStrikeCountLastHour: null,
    precipitationMinutesToday: null,
    precipitationRateMmPerHour: null,
    precipitationTodayMm: null,
    pressureTrend: null,
    relativeHumidityPercent: null,
    seaLevelPressureHpa: null,
    solarRadiationWm2: null,
    uvIndex: null,
    ...overrides,
  };
}

export function unavailableStation(meta: StationMeta, reason: UnavailableReason): Station {
  return { ...meta, status: "unavailable", reason, reading: null, history: null };
}
