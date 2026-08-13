import { isEnsembleValue, type Scalar, type ForecastHour, type SiteForecast } from "../contract.js";
import { localDateKey, p50 } from "../derive/index.js";
import type { MeteogramOptions } from "./types.js";

export interface ResolvedLevel {
  pressureHpa: number;
  heightM: number;
  temperatureC: number;
  dewPointC: number;
  windSpeedMps: number;
  windDirectionDeg: number;
  verticalVelocityPaS: number | null;
  cloudFractionPercent: number | null;
}

export interface ResolvedHour {
  validAt: string;
  surface: {
    seaLevelPressureHpa: number;
    temperatureC: number;
    dewPointC: number;
    windSpeedMps: number;
    windDirectionDeg: number;
    cloudCoverPercent: number;
    precipitationMmHr: number;
    windGustMps: number | null;
    capeJkg: number | null;
    cinJkg: number | null;
    pblHeightM: number | null;
    lowCloudPercent: number | null;
    midCloudPercent: number | null;
    highCloudPercent: number | null;
  };
  levels: ResolvedLevel[];
  /** The hour's own smoke block, medians resolved; null where the model publishes none. */
  smoke: { surfaceUgm3: number; columnMgm2: number; aot: number } | null;
  derived: {
    boundaryLayerTopM: number | null;
    thermalVelocityMps: number;
    cloudBaseM: number;
    usableLiftTopM: number | null;
  };
  bands: {
    seaLevelPressureHpa: Band;
    precipitationMmHr: Band;
    cloudCoverPercent: Band;
    capeJkg: Band;
    pblHeightM: Band;
    thermalVelocityMps: Band;
    boundaryLayerTopM: Band;
    cloudBaseM: Band;
    usableLiftTopM: Band;
  };
}

export type Band = { p25: number; p75: number } | null;

function resolveSmoke(hour: ForecastHour): ResolvedHour["smoke"] {
  if (!hour.smoke) return null;
  const surfaceUgm3 = p50(hour.smoke.surfaceUgm3);
  const columnMgm2 = p50(hour.smoke.columnMgm2);
  const aot = p50(hour.smoke.aot);
  if (surfaceUgm3 === null || columnMgm2 === null || aot === null) return null;
  return { surfaceUgm3, columnMgm2, aot };
}

export function bandOf(value: Scalar | null | undefined): Band {
  if (value == null || !isEnsembleValue(value)) return null;
  if (value.p25 === null || value.p75 === null) return null;
  return { p25: value.p25, p75: value.p75 };
}

export function resolveHour(hour: ForecastHour): ResolvedHour | null {
  const levels: ResolvedLevel[] = [];
  for (const level of hour.levels) {
    const pressureHpa = p50(level.pressureHpa);
    const heightM = p50(level.heightM);
    const temperatureC = p50(level.temperatureC);
    const dewPointC = p50(level.dewPointC);
    const windSpeedMps = p50(level.windSpeedMps);
    const windDirectionDeg = p50(level.windDirectionDeg);
    if (
      pressureHpa === null ||
      heightM === null ||
      temperatureC === null ||
      dewPointC === null ||
      windSpeedMps === null ||
      windDirectionDeg === null
    ) {
      continue;
    }
    levels.push({
      pressureHpa,
      heightM,
      temperatureC,
      dewPointC,
      windSpeedMps,
      windDirectionDeg,
      verticalVelocityPaS: p50(level.verticalVelocityPaS),
      cloudFractionPercent: p50(level.cloudFractionPercent),
    });
  }
  levels.sort((left, right) => left.heightM - right.heightM);

  const seaLevelPressureHpa = p50(hour.surface.seaLevelPressureHpa);
  const temperatureC = p50(hour.surface.temperatureC);
  const dewPointC = p50(hour.surface.dewPointC);
  const windSpeedMps = p50(hour.surface.windSpeedMps);
  const windDirectionDeg = p50(hour.surface.windDirectionDeg);
  const cloudCoverPercent = p50(hour.surface.cloudCoverPercent);
  const precipitationMmHr = p50(hour.surface.precipitationMmHr);
  const thermalVelocityMps = p50(hour.derived.thermalVelocityMps);
  const cloudBaseM = p50(hour.derived.cloudBaseM);
  if (
    seaLevelPressureHpa === null ||
    temperatureC === null ||
    dewPointC === null ||
    windSpeedMps === null ||
    windDirectionDeg === null ||
    cloudCoverPercent === null ||
    precipitationMmHr === null ||
    thermalVelocityMps === null ||
    cloudBaseM === null
  ) {
    return null;
  }

  return {
    validAt: hour.validAt,
    surface: {
      seaLevelPressureHpa,
      temperatureC,
      dewPointC,
      windSpeedMps,
      windDirectionDeg,
      cloudCoverPercent,
      precipitationMmHr,
      windGustMps: p50(hour.surface.windGustMps),
      capeJkg: p50(hour.surface.capeJkg),
      cinJkg: p50(hour.surface.cinJkg),
      pblHeightM: p50(hour.surface.pblHeightM),
      lowCloudPercent: p50(hour.surface.lowCloudPercent),
      midCloudPercent: p50(hour.surface.midCloudPercent),
      highCloudPercent: p50(hour.surface.highCloudPercent),
    },
    levels,
    smoke: resolveSmoke(hour),
    derived: {
      boundaryLayerTopM: p50(hour.derived.boundaryLayerTopM),
      thermalVelocityMps,
      cloudBaseM,
      usableLiftTopM: p50(hour.derived.usableLiftTopM),
    },
    bands: {
      seaLevelPressureHpa: bandOf(hour.surface.seaLevelPressureHpa),
      precipitationMmHr: bandOf(hour.surface.precipitationMmHr),
      cloudCoverPercent: bandOf(hour.surface.cloudCoverPercent),
      capeJkg: bandOf(hour.surface.capeJkg),
      pblHeightM: bandOf(hour.surface.pblHeightM),
      thermalVelocityMps: bandOf(hour.derived.thermalVelocityMps),
      boundaryLayerTopM: bandOf(hour.derived.boundaryLayerTopM),
      cloudBaseM: bandOf(hour.derived.cloudBaseM),
      usableLiftTopM: bandOf(hour.derived.usableLiftTopM),
    },
  };
}

export function resolveHourIndices(
  profile: SiteForecast,
  options: MeteogramOptions,
): readonly number[] | undefined {
  if (options.hourIndices) return options.hourIndices;
  const hours = options.hours;
  if (hours === undefined) return undefined;
  if (isHourArray(hours)) {
    const indexByValidAt = new Map(profile.hours.map((hour, index) => [hour.validAt, index]));
    return hours
      .map((hour) => indexByValidAt.get(hour.validAt))
      .filter((index): index is number => index !== undefined);
  }
  return profile.hours
    .map((hour, index) => index)
    .filter(
      (index) => localDateKey(profile.hours[index].validAt, hours.timeZone) === hours.dateKey,
    );
}

function isHourArray(
  hours: ReadonlyArray<{ validAt: string }> | { timeZone: string; dateKey: string },
): hours is ReadonlyArray<{ validAt: string }> {
  return Array.isArray(hours);
}
