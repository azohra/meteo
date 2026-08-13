import {
  STATION_SCHEMA_VERSION,
  normalizeDegrees,
  speedToMps,
  unavailableStation,
} from "@azohra/meteo.station";
import type { HistoryPoint, Reading, Station, StationFeed } from "@azohra/meteo.station";
import { buildLongHistory, wobble } from "@azohra/meteo.station/fixtures";

const MINUTE_MS = 60_000;

const iso = (ms: number) => new Date(ms).toISOString();
const round1 = (value: number) => Math.round(value * 10) / 10;
const mps = (kmh: number) => Math.round(speedToMps(kmh, "kmh") * 100) / 100;

function launchRidgeHistory(nowMs: number): HistoryPoint[] {
  const anchor = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  const points: HistoryPoint[] = [];
  for (let offset = 359; offset >= 1; offset -= 1) {
    if (offset <= 170 && offset > 150) continue;
    const minuteIndex = 359 - offset;
    let average: number;
    if (minuteIndex < 90) {
      average = 0;
    } else if (minuteIndex < 130) {
      average = Math.max(0, round1(2 + wobble(minuteIndex) * 2.5));
    } else {
      const build = (minuteIndex - 130) / 229;
      average = Math.max(0, round1(build * 16 + 4 + wobble(minuteIndex) * 3.5));
    }
    const calm = average === 0;
    points.push({
      observedAt: iso(anchor - offset * MINUTE_MS),
      windAvgMps: mps(average),
      windGustMps: calm ? 0 : mps(average * 1.35 + 2 + Math.abs(wobble(minuteIndex * 3)) * 3),
      windLullMps: calm ? 0 : mps(Math.max(0, average * 0.6 - 1)),
      windDirectionDeg: calm ? null : round1(normalizeDegrees(312 + wobble(minuteIndex * 7) * 18)),
      temperatureC: round1(9 + (minuteIndex / 359) * 8 + wobble(minuteIndex * 5)),
      seaLevelPressureHpa: round1(1009 + (minuteIndex / 359) * 4 + wobble(minuteIndex * 3) * 0.4),
    });
  }
  return points;
}

function launchRidgeReading(nowMs: number): Reading {
  const seed = Math.floor(nowMs / 2_000);
  const average = 19 + wobble(seed) * 4;
  return {
    observedAt: iso(nowMs),
    windAvgMps: mps(average),
    windDirectionDeg: round1(normalizeDegrees(312 + wobble(seed * 3) * 15)),
    windGustMps: mps(average * 1.3 + 3),
    windLullMps: mps(average * 0.65),
    temperatureC: round1(16.5 + wobble(seed) * 0.3),
    windChillC: null,
    conditions: null,
  };
}

function launchRidge(nowMs: number): Station {
  return {
    id: "launch-ridge",
    name: "Launch Ridge",
    sourceLabel: "WindNerd",
    pageUrl: null,
    latitude: 49.078,
    longitude: -117.785,
    timeZone: "America/Vancouver",
    elevationM: 1245,
    capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
    samplingWindowSeconds: 3,
    recommendedPollSeconds: 5,
    status: "ok",
    reading: launchRidgeReading(nowMs),
    history: { periodMinutes: 1, points: launchRidgeHistory(nowMs) },
  };
}

function summitLoggerHistory(nowMs: number): HistoryPoint[] {
  const period = 5 * MINUTE_MS;
  const anchor = Math.floor(nowMs / period) * period;
  const points: HistoryPoint[] = [];
  for (let offset = 71; offset >= 1; offset -= 1) {
    const index = 71 - offset;
    const average = Math.max(0, round1(24 + (index / 71) * 10 + wobble(index * 2) * 5));
    points.push({
      observedAt: iso(anchor - offset * period),
      windAvgMps: mps(average),
      windGustMps: mps(average + 9 + Math.abs(wobble(index * 11)) * 4),
      windLullMps: mps(Math.max(0, average - 7)),
      windDirectionDeg: round1(normalizeDegrees(205 + (index / 71) * 110 + wobble(index * 9) * 8)),
      temperatureC: round1(3 - (index / 71) * 4 + wobble(index * 13) * 0.5),
    });
  }
  return points;
}

function summitLogger(nowMs: number): Station {
  const seed = Math.floor(nowMs / 2_000);
  const average = 33 + wobble(seed + 40) * 5;
  return {
    id: "summit-logger",
    name: "Summit Logger",
    sourceLabel: "Campbell logger",
    pageUrl: null,
    latitude: 49.106,
    longitude: -117.842,
    timeZone: "America/Vancouver",
    elevationM: 2130,
    capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
    samplingWindowSeconds: 60,
    recommendedPollSeconds: 30,
    status: "ok",
    reading: {
      observedAt: iso(nowMs - 45_000),
      windAvgMps: mps(average),
      windDirectionDeg: round1(normalizeDegrees(305 + wobble(seed * 5) * 10)),
      windGustMps: mps(average + 10),
      windLullMps: mps(average - 8),
      temperatureC: -1.2,
      windChillC: -8.4,
      conditions: null,
    },
    history: { periodMinutes: 5, points: summitLoggerHistory(nowMs) },
  };
}

function valleyTempest(nowMs: number): Station {
  const seed = Math.floor(nowMs / 2_000);
  const average = 9 + wobble(seed + 80) * 3;
  return {
    id: "valley-tempest",
    name: "Valley Tempest",
    sourceLabel: "WeatherFlow Tempest",
    pageUrl: null,
    latitude: 49.099,
    longitude: -117.7,
    timeZone: "America/Vancouver",
    elevationM: 610,
    capabilities: { gustLull: true, temperature: true, conditions: true, history: false },
    samplingWindowSeconds: 60,
    recommendedPollSeconds: 60,
    status: "ok",
    reading: {
      observedAt: iso(nowMs - 20_000),
      windAvgMps: mps(Math.max(0, average)),
      windDirectionDeg: round1(normalizeDegrees(155 + wobble(seed * 7) * 20)),
      windGustMps: mps(average + 5),
      windLullMps: mps(Math.max(0, average - 4)),
      temperatureC: 14.3,
      windChillC: null,
      conditions: {
        dewPointC: 8.4,
        lastLightningStrikeAt: iso(nowMs - 47 * MINUTE_MS),
        lastLightningStrikeDistanceKm: 19,
        lightningStrikeCountLastHour: 2,
        precipitationMinutesToday: 12,
        precipitationRateMmPerHour: 0,
        precipitationTodayMm: 1.6,
        pressureTrend: "falling",
        relativeHumidityPercent: 64,
        seaLevelPressureHpa: 1012.6,
        solarRadiationWm2: 512,
        uvIndex: 6.2,
      },
    },
    history: null,
  };
}

const northBluff: Station = unavailableStation(
  {
    id: "north-bluff",
    name: "North Bluff",
    sourceLabel: "WindNerd",
    pageUrl: null,
    latitude: 49.128,
    longitude: -117.771,
    timeZone: "America/Vancouver",
    elevationM: 980,
    capabilities: { gustLull: true, temperature: false, conditions: false, history: true },
    samplingWindowSeconds: 3,
    recommendedPollSeconds: 5,
  },
  "upstream_error",
);

export function buildExhibitFeed(nowMs: number): StationFeed {
  return {
    schemaVersion: STATION_SCHEMA_VERSION,
    servedAt: iso(nowMs),
    primaryStationId: "launch-ridge",
    stations: [launchRidge(nowMs), summitLogger(nowMs), valleyTempest(nowMs), northBluff],
  };
}

const HISTORY_LAB_DAYS = 4;
const HISTORY_LAB_POINTS_PER_DAY = (24 * 60) / 5;

function historyLabHistory(nowMs: number): HistoryPoint[] {
  const period = 5 * MINUTE_MS;
  const anchor = Math.floor(nowMs / period) * period;
  const totalPoints = HISTORY_LAB_DAYS * HISTORY_LAB_POINTS_PER_DAY;
  const points: HistoryPoint[] = [];
  for (let offset = totalPoints; offset >= 1; offset -= 1) {
    const index = totalPoints - offset;
    const dayIndex = Math.floor(index / HISTORY_LAB_POINTS_PER_DAY);
    const minuteOfDay = index % HISTORY_LAB_POINTS_PER_DAY;
    const diurnal = Math.sin(
      (minuteOfDay / HISTORY_LAB_POINTS_PER_DAY) * Math.PI * 2 - Math.PI / 2,
    );
    const average = Math.max(0, round1(16 + diurnal * 7 + dayIndex * 1.4 + wobble(index * 2) * 3));
    points.push({
      observedAt: iso(anchor - offset * period),
      windAvgMps: mps(average),
      windGustMps: mps(average + 7 + Math.abs(wobble(index * 11)) * 3),
      windLullMps: mps(Math.max(0, average - 5)),
      windDirectionDeg: round1(
        normalizeDegrees(280 + diurnal * 35 + dayIndex * 5 + wobble(index * 9) * 8),
      ),
      temperatureC: round1(11 - diurnal * -3 + wobble(index * 13) * 0.6),
    });
  }
  return points;
}

export function buildHistoryLabStation(nowMs: number): Station {
  const points = historyLabHistory(nowMs);
  const last = points[points.length - 1] as HistoryPoint;
  return {
    id: "history-lab",
    name: "History Lab",
    sourceLabel: "Generated fixture",
    pageUrl: null,
    latitude: 49.09,
    longitude: -117.82,
    timeZone: "America/Vancouver",
    elevationM: 1450,
    capabilities: { gustLull: true, temperature: true, conditions: false, history: true },
    samplingWindowSeconds: 3,
    recommendedPollSeconds: 60,
    status: "ok",
    reading: {
      observedAt: last.observedAt,
      windAvgMps: last.windAvgMps,
      windDirectionDeg: last.windDirectionDeg,
      windGustMps: last.windGustMps as number,
      windLullMps: last.windLullMps as number,
      temperatureC: last.temperatureC,
      windChillC: null,
      conditions: null,
    },
    history: { periodMinutes: 5, points },
  };
}

export function buildSeason(): HistoryPoint[] {
  return buildLongHistory({ nowMs: Date.now(), days: 420, periodMinutes: 15 });
}
