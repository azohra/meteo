import type { AirConditions } from "./contract.js";
import { defaultStrings } from "./strings.js";
import type { FormatTime, StationStrings } from "./strings.js";

const round1 = (value: number) => Math.round(value * 10) / 10;

export function airSummary(
  conditions: AirConditions,
  strings: StationStrings = defaultStrings,
): string {
  const words = strings.air;
  const rain =
    conditions.precipitationRateMmPerHour != null && conditions.precipitationRateMmPerHour > 0
      ? words.summaryRaining(round1(conditions.precipitationRateMmPerHour))
      : conditions.precipitationTodayMm == null
        ? null
        : conditions.precipitationTodayMm > 0
          ? words.summaryRainToday(round1(conditions.precipitationTodayMm))
          : words.summaryDry;
  const pieces = [
    conditions.relativeHumidityPercent == null
      ? null
      : words.summaryHumidity(Math.round(conditions.relativeHumidityPercent)),
    rain,
    conditions.lightningStrikeCountLastHour != null && conditions.lightningStrikeCountLastHour > 0
      ? words.summaryStrikes(conditions.lightningStrikeCountLastHour)
      : null,
  ].filter((piece): piece is string => piece != null);
  return pieces.length > 0 ? pieces.join(" · ") : words.summaryFallback;
}

export function lastStrikeWords(
  conditions: AirConditions,
  formatTime: FormatTime,
  strings: StationStrings = defaultStrings,
): string {
  const words = strings.air;
  if (conditions.lastLightningStrikeAt == null) return words.noStrike;
  const time = formatTime(new Date(conditions.lastLightningStrikeAt));
  return conditions.lastLightningStrikeDistanceKm == null
    ? words.lastStrikeNoDistance(time)
    : words.lastStrike(Math.round(conditions.lastLightningStrikeDistanceKm), time);
}

export type AirRow = {
  label: string;
  unit: string;
  value: (conditions: AirConditions) => string | null;
};

export function airRows(words: StationStrings): AirRow[] {
  const air = words.air;
  return [
    {
      label: air.humidity,
      unit: air.unitPercent,
      value: (c) =>
        c.relativeHumidityPercent == null ? null : `${Math.round(c.relativeHumidityPercent)}`,
    },
    {
      label: air.dewPoint,
      unit: words.degC,
      value: (c) => c.dewPointC?.toFixed(1) ?? null,
    },
    {
      label: air.pressure,
      unit: air.unitHpa,
      value: (c) => c.seaLevelPressureHpa?.toFixed(1) ?? null,
    },
    {
      label: air.pressureTrend,
      unit: "",
      value: (c) =>
        c.pressureTrend === "falling"
          ? air.trendFalling
          : c.pressureTrend === "rising"
            ? air.trendRising
            : c.pressureTrend === "steady"
              ? air.trendSteady
              : null,
    },
    {
      label: air.solar,
      unit: air.unitWm2,
      value: (c) => (c.solarRadiationWm2 == null ? null : `${Math.round(c.solarRadiationWm2)}`),
    },
    {
      label: air.uv,
      unit: air.unitIndex,
      value: (c) => (c.uvIndex == null ? null : `${Math.round(c.uvIndex * 10) / 10}`),
    },
    {
      label: air.rainRate,
      unit: air.unitMmPerHour,
      value: (c) => c.precipitationRateMmPerHour?.toFixed(1) ?? null,
    },
    {
      label: air.rainToday,
      unit: air.unitMm,
      value: (c) => c.precipitationTodayMm?.toFixed(1) ?? null,
    },
    {
      label: air.rainMinutes,
      unit: air.unitMinutes,
      value: (c) => (c.precipitationMinutesToday == null ? null : `${c.precipitationMinutesToday}`),
    },
    {
      label: air.lightning,
      unit: air.unitStrikesPastHour,
      value: (c) =>
        c.lightningStrikeCountLastHour == null ? null : `${c.lightningStrikeCountLastHour}`,
    },
  ];
}
