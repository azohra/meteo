import type { ExampleArtifact, SchemaArtifact } from "@azohra/meteo.core";
import {
  stationCurrentSchema,
  stationFeedSchema,
  stationHistorySchema,
  stationLiveFrameSchema,
} from "../contract.js";
import { stationClimatologySchema } from "../contract-climatology.js";

export const schemaArtifacts: readonly SchemaArtifact[] = [
  {
    fileName: "stationfeed.schema.json",
    title: "StationFeed",
    schema: stationFeedSchema,
    description:
      "The multi-station feed served at /feed. Readers must ignore unknown keys: new fields arrive nullable without a schemaVersion bump.",
  },
  {
    fileName: "stationcurrent.schema.json",
    title: "StationCurrent",
    schema: stationCurrentSchema,
    description:
      "The single-station light document served at /current. Reuses the station shape with history null so clients need one decoder.",
  },
  {
    fileName: "stationlive.schema.json",
    title: "StationLiveFrame",
    schema: stationLiveFrameSchema,
    description:
      "One frame per SSE data event on the /live stream. init seeds a full station document; samples and reading update it; unavailable is terminal — the stream closes after it.",
  },
  {
    fileName: "stationhistory.schema.json",
    title: "StationHistory",
    schema: stationHistorySchema,
    description:
      "One requested archive window served at /history — the pan/zoom road. Reuses the history shape; periodMinutes echoes what the source actually supplied.",
  },
  {
    fileName: "stationclimatology.schema.json",
    title: "StationClimatology",
    schema: stationClimatologySchema,
    description:
      "The multi-year cube served at /climatology: (month, slot-of-day, sector) sums bucketed in the station's standard time, binned with the consumer's thresholds. Its own document family — it versions apart from the feed.",
  },
];

const exampleFeed = {
  $comment:
    "Example @azohra/meteo.station feed document. Validates against stationfeed.schema.json; " +
    "readers must ignore unknown keys (this one included).",
  schemaVersion: 2,
  servedAt: "2026-08-05T22:13:00.000Z",
  primaryStationId: "meadow",
  stations: [
    {
      id: "meadow",
      name: "Ridge Meadow",
      sourceLabel: "Tempest",
      pageUrl: "https://example.com/stations/ridge-meadow",
      latitude: 49.5,
      longitude: -118.5,
      timeZone: "America/Vancouver",
      elevationM: 1180,
      capabilities: { gustLull: true, temperature: true, conditions: true, history: false },
      samplingWindowSeconds: 60,
      recommendedPollSeconds: 60,
      status: "ok",
      reading: {
        observedAt: "2026-08-05T22:13:00.000Z",
        windAvgMps: 2.5,
        windDirectionDeg: 273,
        windGustMps: 4.2,
        windLullMps: 1.1,
        temperatureC: 21.5,
        windChillC: 20.9,
        conditions: {
          dewPointC: 7.5,
          lastLightningStrikeAt: null,
          lastLightningStrikeDistanceKm: null,
          lightningStrikeCountLastHour: null,
          precipitationMinutesToday: 0,
          precipitationRateMmPerHour: 0,
          precipitationTodayMm: 0,
          pressureTrend: "steady",
          relativeHumidityPercent: 40,
          seaLevelPressureHpa: 1014.2,
          solarRadiationWm2: 645,
          uvIndex: 5.8,
        },
      },
      history: null,
    },
    {
      id: "bluff",
      name: "Bluff Launch",
      sourceLabel: "WindNerd",
      pageUrl: "https://example.com/stations/bluff-launch",
      latitude: 49.7,
      longitude: -118.2,
      timeZone: "America/Vancouver",
      elevationM: 1370,
      capabilities: {
        gustLull: true,
        temperature: true,
        conditions: true,
        history: true,
        live: true,
        battery: true,
      },
      samplingWindowSeconds: 60,
      recommendedPollSeconds: 60,
      status: "ok",
      reading: {
        observedAt: "2026-08-05T22:12:45.000Z",
        windAvgMps: 2.5,
        windDirectionDeg: 290,
        windGustMps: 3.9,
        windLullMps: 1.7,
        temperatureC: 22.6,
        windChillC: null,
        conditions: {
          dewPointC: null,
          lastLightningStrikeAt: null,
          lastLightningStrikeDistanceKm: null,
          lightningStrikeCountLastHour: null,
          precipitationMinutesToday: null,
          precipitationRateMmPerHour: null,
          precipitationTodayMm: null,
          pressureTrend: "steady",
          relativeHumidityPercent: null,
          seaLevelPressureHpa: 1006.1,
          solarRadiationWm2: null,
          uvIndex: null,
        },
      },
      history: {
        periodMinutes: 1,
        points: [
          {
            observedAt: "2026-08-05T22:10:45.000Z",
            windAvgMps: 1.7,
            windGustMps: 2.2,
            windLullMps: 1.1,
            windDirectionDeg: 300,
            temperatureC: 20.2,
            seaLevelPressureHpa: 1007.7,
          },
          {
            observedAt: "2026-08-05T22:11:45.000Z",
            windAvgMps: 3.3,
            windGustMps: 5.8,
            windLullMps: 1.9,
            windDirectionDeg: 310,
            temperatureC: null,
            seaLevelPressureHpa: null,
          },
          {
            observedAt: "2026-08-05T22:12:45.000Z",
            windAvgMps: 2.5,
            windGustMps: 3.9,
            windLullMps: 1.7,
            windDirectionDeg: 290,
            temperatureC: 22.6,
            seaLevelPressureHpa: 1006.1,
          },
        ],
      },
      telemetry: { batteryVoltage: 4.15 },
      samples: {
        intervalSeconds: 3,
        points: [
          { observedAt: "2026-08-05T22:12:39.000Z", windMps: 2.2, windDirectionDeg: 288 },
          { observedAt: "2026-08-05T22:12:42.000Z", windMps: 2.7, windDirectionDeg: 291 },
          { observedAt: "2026-08-05T22:12:45.000Z", windMps: 0.3, windDirectionDeg: null },
        ],
      },
    },
    {
      id: "narrows",
      name: "Gorge Narrows",
      sourceLabel: "Campbell logger",
      pageUrl: "https://example.com/stations/gorge-narrows",
      latitude: 49.3,
      longitude: -118.8,
      timeZone: "America/Vancouver",
      elevationM: 460,
      capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
      samplingWindowSeconds: 3,
      recommendedPollSeconds: 15,
      status: "unavailable",
      reason: "upstream_error",
      reading: null,
      history: null,
    },
  ],
};

const exampleCurrent = {
  $comment:
    "Example @azohra/meteo.station current document. Validates against " +
    "stationcurrent.schema.json; readers must ignore unknown keys (this one included).",
  schemaVersion: 2,
  servedAt: "2026-08-05T22:13:00.000Z",
  station: {
    ...exampleFeed.stations[0],
    history: null,
  },
};

const exampleLive = {
  $comment:
    "Example @azohra/meteo.station live frame — the init frame that opens every " +
    "/live stream. Each SSE data event validates against stationlive.schema.json; " +
    "readers must ignore unknown keys (this one included).",
  type: "init",
  schemaVersion: 2,
  servedAt: "2026-08-05T22:13:00.000Z",
  station: {
    ...exampleFeed.stations[1],
    history: null,
  },
};

const exampleClimatology = {
  $comment:
    "Example @azohra/meteo.station climatology document. Validates against " +
    "stationclimatology.schema.json; readers must ignore unknown keys (this one included). " +
    "Cells nothing ever fell into are absent, never zero-filled; sums re-aggregate " +
    "losslessly under any month/season/slot filter.",
  schemaVersion: 1,
  servedAt: "2026-08-05T22:13:00.000Z",
  stationId: "bluff",
  sectorCount: 16,
  slotMinutes: 180,
  thresholdsMps: [3.3333333333333335, 5.555555555555555, 7.777777777777778],
  utcOffsetMinutes: -480,
  years: [
    { year: 2025, sampleCount: 2496, expectedCount: 2920 },
    { year: 2026, sampleCount: 1704, expectedCount: 1736 },
  ],
  cells: [
    {
      month: 7,
      slot: 4,
      sampleCount: 58,
      calmCount: 11,
      sectors: [
        {
          sector: 12,
          count: 31,
          uSum: 148.2033,
          vSum: -42.1188,
          speedSumMps: 167.4,
          bandCounts: [4, 9, 12, 6],
          maxGustMps: 11.8,
        },
        {
          sector: 13,
          count: 16,
          uSum: 61.077,
          vSum: -33.9414,
          speedSumMps: 72.1,
          bandCounts: [3, 6, 5, 2],
          maxGustMps: 9.4,
        },
      ],
    },
    {
      month: 7,
      slot: 5,
      sampleCount: 49,
      calmCount: 20,
      sectors: [
        {
          sector: 12,
          count: 29,
          uSum: 101.9385,
          vSum: -28.9704,
          speedSumMps: 114.9,
          bandCounts: [8, 11, 8, 2],
          maxGustMps: 10.2,
        },
      ],
    },
  ],
};

const exampleHistory = {
  $comment:
    "Example @azohra/meteo.station history-window document. Validates against " +
    "stationhistory.schema.json; readers must ignore unknown keys (this one included).",
  schemaVersion: 2,
  servedAt: "2026-08-05T22:13:00.000Z",
  stationId: "bluff",
  history: (exampleFeed.stations[1] as { history: unknown }).history,
};

export const exampleArtifacts: readonly ExampleArtifact[] = [
  { fileName: "example-feed.json", document: exampleFeed, schema: stationFeedSchema },
  { fileName: "example-current.json", document: exampleCurrent, schema: stationCurrentSchema },
  { fileName: "example-live.json", document: exampleLive, schema: stationLiveFrameSchema },
  { fileName: "example-history.json", document: exampleHistory, schema: stationHistorySchema },
  {
    fileName: "example-climatology.json",
    document: exampleClimatology,
    schema: stationClimatologySchema,
  },
];
