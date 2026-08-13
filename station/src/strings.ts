import type { UnavailableReason } from "./contract.js";
import { speedUnitLabel } from "./derive.js";
import type { CompassPoint, FreshnessStatus, SpeedUnit } from "./derive.js";

export const EM_DASH = "—";

export type StationStrings = {
  averageLabel: string;
  avgLabel: string;
  calm: string;
  calmHistory: string;
  degC: string;
  feelsLikeLabel: string;
  fromLabel: string;
  gustLabel: string;
  inspectHint: string;
  km: string;
  lullLabel: string;
  minLabel: string;
  noHistory: string;
  notMeasured: string;
  notReporting: string;
  peakLabel: string;
  tempRangeLabel: string;
  trendPressure: string;
  trendTemperature: string;
  toLabel: string;
  windRunLabel: string;
  elevation: (metres: number) => string;
  percentCalm: (percent: number) => string;
  percentShare: (percent: number) => string;
  dailyPatternSamples: (sampleCount: number) => string;
  dailyPatternCoverage: (sampleCount: number, expectedCount: number) => string;
  compassSpoken: Record<CompassPoint, string>;
  updated: {
    justNow: string;
    minutesAgo: (minutes: number) => string;
    hoursAgo: (hours: number) => string;
  };
  freshness: Record<FreshnessStatus, string>;
  reasons: Record<UnavailableReason, string>;
  speedUnits: Record<SpeedUnit, string>;
  table: {
    station: string;
    wind: string;
    lull: string;
    gust: string;
    from: string;
    temp: string;
    updated: string;
  };
  air: {
    title: string;
    summaryFallback: string;
    summaryHumidity: (percent: number) => string;
    summaryRaining: (mmPerHour: number) => string;
    summaryRainToday: (mm: number) => string;
    summaryDry: string;
    summaryStrikes: (count: number) => string;
    noStrike: string;
    lastStrike: (distanceKm: number, time: string) => string;
    lastStrikeNoDistance: (time: string) => string;
    trendFalling: string;
    trendRising: string;
    trendSteady: string;
    feelsLike: string;
    humidity: string;
    dewPoint: string;
    pressure: string;
    pressureTrend: string;
    solar: string;
    uv: string;
    rainRate: string;
    rainToday: string;
    rainMinutes: string;
    lightning: string;
    unitPercent: string;
    unitHpa: string;
    unitWm2: string;
    unitIndex: string;
    unitMmPerHour: string;
    unitMm: string;
    unitMinutes: string;
    unitStrikesPastHour: string;
  };
  aria: {
    air: (stationCount: number) => string;
    chart: (stationName: string) => string;
    table: (stationCount: number) => string;
    current: (stationName: string) => string;
    dailyPattern: (stationName: string) => string;
    dailyPatternGeneric: string;
    direction: (spoken: string, deg: number) => string;
    readout: (stationName: string) => string;
    rose: (stationName: string) => string;
    roseFavorable: (sectors: string) => string;
    roseGeneric: string;
    sparkline: (stationName: string) => string;
    strip: (stationName: string) => string;
    summary: (endedAtFormatted: string) => string;
    trend: (stationName: string, seriesName: string) => string;
  };
};

export const defaultStrings: StationStrings = {
  averageLabel: "Average",
  avgLabel: "avg",
  calm: "Calm",
  calmHistory: "Calm for the entire period",
  degC: "°C",
  feelsLikeLabel: "feels like",
  fromLabel: "from",
  gustLabel: "gust",
  inspectHint: "hover or tap to inspect",
  km: "km",
  lullLabel: "lull",
  minLabel: "Min",
  noHistory: "No history available",
  notMeasured: "Not measured here",
  notReporting: "Not reporting",
  peakLabel: "Peak",
  tempRangeLabel: "Temp",
  trendPressure: "Pressure",
  trendTemperature: "Temperature",
  toLabel: "TO",
  windRunLabel: "Wind run",
  elevation: (metres) => `${metres} m`,
  percentCalm: (percent) => `${percent}% calm`,
  percentShare: (percent) => `${percent}%`,
  dailyPatternSamples: (sampleCount) => `${sampleCount} samples`,
  dailyPatternCoverage: (sampleCount, expectedCount) =>
    `${sampleCount} samples · ${Math.round((sampleCount / Math.max(1, expectedCount)) * 100)}%`,
  compassSpoken: {
    N: "north",
    NNE: "north-northeast",
    NE: "northeast",
    ENE: "east-northeast",
    E: "east",
    ESE: "east-southeast",
    SE: "southeast",
    SSE: "south-southeast",
    S: "south",
    SSW: "south-southwest",
    SW: "southwest",
    WSW: "west-southwest",
    W: "west",
    WNW: "west-northwest",
    NW: "northwest",
    NNW: "north-northwest",
  },
  updated: {
    justNow: "just now",
    minutesAgo: (minutes) => `${minutes} min ago`,
    hoursAgo: (hours) => `${hours} hr ago`,
  },
  freshness: {
    live: "Live",
    aging: "Aging",
    stale: "Stale",
  },
  reasons: {
    upstream_error: "Station not responding",
    contract_break: "Station sent unreadable data",
    timeout: "Station timed out",
    not_configured: "Station not configured",
    rate_limited: "Update limit reached",
  },
  speedUnits: {
    kmh: speedUnitLabel("kmh"),
    knots: speedUnitLabel("knots"),
    mph: speedUnitLabel("mph"),
    mps: speedUnitLabel("mps"),
  },
  table: {
    station: "Station",
    wind: "Wind",
    lull: "Lull",
    gust: "Gust",
    from: "From",
    temp: "Temp",
    updated: "Updated",
  },
  air: {
    title: "Air and precipitation",
    summaryFallback: "Humidity, pressure, rain and lightning",
    summaryHumidity: (percent) => `humidity ${percent}%`,
    summaryRaining: (mmPerHour) => `raining ${mmPerHour} mm/h`,
    summaryRainToday: (mm) => `rain ${mm} mm today`,
    summaryDry: "dry today",
    summaryStrikes: (count) => `${count} ${count === 1 ? "strike" : "strikes"} past hour`,
    noStrike: "No lightning strike on record.",
    lastStrike: (distanceKm, time) => `Last recorded strike ${distanceKm} km away, ${time}.`,
    lastStrikeNoDistance: (time) => `Last recorded strike ${time}, distance unknown.`,
    trendFalling: "falling",
    trendRising: "rising",
    trendSteady: "steady",
    feelsLike: "Feels like",
    humidity: "Humidity",
    dewPoint: "Dew point",
    pressure: "Pressure",
    pressureTrend: "Trend",
    solar: "Solar",
    uv: "UV index",
    rainRate: "Rain rate",
    rainToday: "Rain today",
    rainMinutes: "Raining today",
    lightning: "Lightning",
    unitPercent: "%",
    unitHpa: "hPa",
    unitWm2: "W/m²",
    unitIndex: "index",
    unitMmPerHour: "mm/h",
    unitMm: "mm",
    unitMinutes: "minutes",
    unitStrikesPastHour: "strikes past hour",
  },
  aria: {
    air: (stationCount) => `Air and precipitation readings from ${stationCount} stations`,
    chart: (stationName) =>
      `Wind history at ${stationName}: the band spans lull to gust, the line is the average, and the vanes below point where the wind blew to.`,
    table: (stationCount) => `Live readings from ${stationCount} stations`,
    current: (stationName) => `Current conditions at ${stationName}`,
    dailyPattern: (stationName) =>
      `Typical day at ${stationName}, averaged across the full history`,
    dailyPatternGeneric: "Typical day, averaged across the full history",
    direction: (spoken, deg) => `from ${spoken}, ${deg} degrees`,
    readout: (stationName) => `Inspected reading at ${stationName}`,
    rose: (stationName) => `Wind direction distribution at ${stationName}`,
    roseFavorable: (sectors) => `The outer ring marks favorable directions: from ${sectors}.`,
    roseGeneric: "Wind direction distribution",
    sparkline: (stationName) => `six hours of wind at ${stationName}`,
    strip: (stationName) => `Latest reading at ${stationName}`,
    summary: (endedAtFormatted) => `Summary of the period ending ${endedAtFormatted}`,
    trend: (stationName, seriesName) => `${seriesName} history at ${stationName}`,
  },
};

export type StationStringOverrides = Partial<
  Omit<
    StationStrings,
    "compassSpoken" | "updated" | "freshness" | "reasons" | "speedUnits" | "table" | "air" | "aria"
  > & {
    compassSpoken: Partial<StationStrings["compassSpoken"]>;
    updated: Partial<StationStrings["updated"]>;
    freshness: Partial<StationStrings["freshness"]>;
    reasons: Partial<StationStrings["reasons"]>;
    speedUnits: Partial<StationStrings["speedUnits"]>;
    table: Partial<StationStrings["table"]>;
    air: Partial<StationStrings["air"]>;
    aria: Partial<StationStrings["aria"]>;
  }
>;

export function resolveStrings(overrides?: StationStringOverrides): StationStrings {
  if (!overrides) return defaultStrings;
  return {
    ...defaultStrings,
    ...overrides,
    compassSpoken: { ...defaultStrings.compassSpoken, ...overrides.compassSpoken },
    updated: { ...defaultStrings.updated, ...overrides.updated },
    freshness: { ...defaultStrings.freshness, ...overrides.freshness },
    reasons: { ...defaultStrings.reasons, ...overrides.reasons },
    speedUnits: { ...defaultStrings.speedUnits, ...overrides.speedUnits },
    table: { ...defaultStrings.table, ...overrides.table },
    air: { ...defaultStrings.air, ...overrides.air },
    aria: { ...defaultStrings.aria, ...overrides.aria },
  };
}

export function mergeStringOverrides(
  outer: StationStringOverrides | undefined,
  inner: StationStringOverrides | undefined,
): StationStringOverrides | undefined {
  if (!outer) return inner;
  if (!inner) return outer;
  return {
    ...outer,
    ...inner,
    compassSpoken: { ...outer.compassSpoken, ...inner.compassSpoken },
    updated: { ...outer.updated, ...inner.updated },
    freshness: { ...outer.freshness, ...inner.freshness },
    reasons: { ...outer.reasons, ...inner.reasons },
    speedUnits: { ...outer.speedUnits, ...inner.speedUnits },
    table: { ...outer.table, ...inner.table },
    air: { ...outer.air, ...inner.air },
    aria: { ...outer.aria, ...inner.aria },
  };
}

export type FormatTime = (date: Date) => string;

/* An undefined locale means "this runtime's default", which can differ between
 * an SSR pass and hydration; pin an explicit locale when markup must match. */
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function timeFormat(locale: string | undefined): Intl.DateTimeFormat {
  const key = locale ?? "";
  let format = timeFormats.get(key);
  if (format == null) {
    format = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
    timeFormats.set(key, format);
  }
  return format;
}

export function defaultFormatTime(date: Date): string {
  return timeFormat(undefined).format(date);
}

const localeFormatTimes = new Map<string, FormatTime>();

export function localeFormatTime(locale: string): FormatTime {
  let format = localeFormatTimes.get(locale);
  if (format == null) {
    format = (date) => timeFormat(locale).format(date);
    localeFormatTimes.set(locale, format);
  }
  return format;
}
