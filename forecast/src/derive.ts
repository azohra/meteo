import {
  DRY_ADIABATIC_LAPSE_C_PER_M,
  normalizeDegrees,
  usableLiftTopM,
} from "@azohra/meteo.briefing/derive";
import {
  SITE_FORECAST_SCHEMA_VERSION,
  type ForecastHour,
  type ForecastLevel,
  type ForecastSemantics,
  type ForecastSite,
  type ForecastSmoke,
  type ForecastSurface,
  type SiteForecast,
} from "@azohra/meteo.briefing/contract";

// Matches the renderer's dense-cloud hatch threshold so the published cloud
// base never sits above a layer the chart hatches.
const SATURATED_DEPRESSION_C = 0.5;

export interface SourceLevel {
  pressureHpa: number;
  heightM: number;
  temperatureC: number;
  dewPointDepressionC: number;
  windSpeedMps: number;
  windDirectionDeg: number;
  verticalVelocityPaS?: number;
  cloudFractionPercent?: number;
}

export interface SourceHour {
  validAt: string;
  seaLevelPressureHpa: number;
  temperatureC: number;
  dewPointDepressionC: number;
  windSpeedMps: number;
  windDirectionDeg: number;
  cloudCoverPercent: number;
  precipitationMm: number;
  sensibleHeatFluxWm2: number;
  latentHeatFluxWm2: number;
  levels: SourceLevel[];
  windGustMps?: number;
  capeJkg?: number;
  cinJkg?: number;
  pblHeightM?: number;
  lowCloudPercent?: number;
  midCloudPercent?: number;
  highCloudPercent?: number;
  smoke?: Record<string, number>;
}

export interface SourceProfile {
  generatedAt: string;
  referenceTime: string;
  latitude: number;
  longitude: number;
  modelElevationM: number;
  siteId: string;
  siteName: string;
  siteTimeZone?: string | null;
  hours: SourceHour[];
}

export function deriveSiteForecast(
  source: SourceProfile,
  model: string,
  semantics: ForecastSemantics,
): SiteForecast {
  const site: ForecastSite = {
    id: source.siteId,
    name: source.siteName,
    latitude: source.latitude,
    longitude: source.longitude,
    modelElevationM: source.modelElevationM,
  };
  if (source.siteTimeZone) {
    site.timeZone = source.siteTimeZone;
  }
  return {
    schemaVersion: SITE_FORECAST_SCHEMA_VERSION,
    model,
    run: {
      referenceTime: source.referenceTime,
      generatedAt: source.generatedAt,
    },
    site,
    semantics,
    hours: source.hours.map((hour) => deriveHour(hour, source.modelElevationM)),
  };
}

function deriveHour(source: SourceHour, modelElevationM: number): ForecastHour {
  const levels = source.levels
    .filter((level) => Number.isFinite(level.heightM) && level.heightM > modelElevationM + 20)
    .sort((a, b) => a.heightM - b.heightM);

  const cloudBaseM = deriveCloudBaseM(
    source.temperatureC,
    source.dewPointDepressionC,
    modelElevationM,
    levels,
  );
  const boundaryLayerDepthM = boundaryLayerDepth(source.temperatureC, modelElevationM, levels);
  const thermalVelocityMps = thermalVelocity(
    source.temperatureC,
    source.sensibleHeatFluxWm2,
    source.latentHeatFluxWm2,
    boundaryLayerDepthM,
    levels.length > 0 ? levels[0].pressureHpa : null,
  );
  const usableLiftTopMValue = usableLiftTopM(
    {
      modelElevationM,
      boundaryLayerTopM: boundaryLayerDepthM > 0 ? modelElevationM + boundaryLayerDepthM : null,
      thermalVelocityMps,
      cloudBaseM,
      levels,
    },
    // usableLiftTopM's own published-contract default sink rate applies.
  );

  const surface: ForecastSurface = {
    seaLevelPressureHpa: source.seaLevelPressureHpa,
    temperatureC: source.temperatureC,
    dewPointC: source.temperatureC - source.dewPointDepressionC,
    windSpeedMps: Math.max(0.0, source.windSpeedMps),
    windDirectionDeg: normalizeDegrees(source.windDirectionDeg),
    cloudCoverPercent: clamp(source.cloudCoverPercent, 0.0, 100.0),
    precipitationMmHr: Math.max(0.0, source.precipitationMm),
    sensibleHeatFluxWm2: source.sensibleHeatFluxWm2,
    latentHeatFluxWm2: source.latentHeatFluxWm2,
  };
  for (const [fieldName, sanitize] of OPTIONAL_SURFACE_FIELDS_IN_CONTRACT_ORDER) {
    if (fieldName in source) {
      surface[fieldName] = sanitize(source[fieldName] as number);
    }
  }

  const hour: ForecastHour = {
    validAt: source.validAt,
    surface,
    levels: levels.map(deriveLevel),
    derived: {
      boundaryLayerTopM: boundaryLayerDepthM > 0 ? modelElevationM + boundaryLayerDepthM : null,
      thermalVelocityMps,
      cloudBaseM,
      usableLiftTopM: usableLiftTopMValue,
    },
  };
  if (source.smoke !== undefined) {
    hour.smoke = Object.fromEntries(
      Object.entries(source.smoke).map(([name, value]) => [name, Math.max(0.0, value)]),
    ) as unknown as ForecastSmoke;
  }
  return hour;
}

const OPTIONAL_SURFACE_FIELDS_IN_CONTRACT_ORDER = [
  ["windGustMps", (v: number) => Math.max(0.0, v)],
  ["capeJkg", (v: number) => Math.max(0.0, v)],
  ["cinJkg", (v: number) => Math.min(0.0, v)],
  ["pblHeightM", (v: number) => Math.max(0.0, v)],
  ["lowCloudPercent", (v: number) => clamp(v, 0.0, 100.0)],
  ["midCloudPercent", (v: number) => clamp(v, 0.0, 100.0)],
  ["highCloudPercent", (v: number) => clamp(v, 0.0, 100.0)],
] as const;

function deriveLevel(level: SourceLevel): ForecastLevel {
  const derived: ForecastLevel = {
    pressureHpa: level.pressureHpa,
    heightM: level.heightM,
    temperatureC: level.temperatureC,
    dewPointC: level.temperatureC - level.dewPointDepressionC,
    windSpeedMps: Math.max(0.0, level.windSpeedMps),
    windDirectionDeg: normalizeDegrees(level.windDirectionDeg),
  };
  if (level.verticalVelocityPaS !== undefined) {
    derived.verticalVelocityPaS = level.verticalVelocityPaS;
  }
  if (level.cloudFractionPercent !== undefined) {
    derived.cloudFractionPercent = clamp(level.cloudFractionPercent, 0.0, 100.0);
  }
  return derived;
}

function deriveCloudBaseM(
  surfaceTemperatureC: number,
  dewPointDepressionC: number,
  modelElevationM: number,
  levels: SourceLevel[],
): number {
  let cloudBaseM =
    modelElevationM + parcelLclAglM(surfaceTemperatureC, surfaceTemperatureC - dewPointDepressionC);
  const firstSaturatedM = firstSaturatedAltitudeM(dewPointDepressionC, modelElevationM, levels);
  if (firstSaturatedM !== null) {
    cloudBaseM = Math.min(cloudBaseM, firstSaturatedM);
  }
  return clampAltitude(cloudBaseM, modelElevationM);
}

// LCL temperature per Bolton (1980, Mon. Wea. Rev. 108, eq. 15).
function parcelLclAglM(temperatureC: number, dewPointC: number): number {
  if (dewPointC >= temperatureC) {
    return 0.0;
  }
  const temperatureK = temperatureC + 273.15;
  const dewPointK = dewPointC + 273.15;
  const lclTemperatureK =
    1.0 / (1.0 / (dewPointK - 56.0) + Math.log(temperatureK / dewPointK) / 800.0) + 56.0;
  return Math.max(0.0, (temperatureK - lclTemperatureK) / DRY_ADIABATIC_LAPSE_C_PER_M);
}

function firstSaturatedAltitudeM(
  surfaceDewPointDepressionC: number,
  modelElevationM: number,
  levels: SourceLevel[],
): number | null {
  const profile: Array<[number, number]> = [
    [modelElevationM, surfaceDewPointDepressionC] as [number, number],
    ...levels.map((level): [number, number] => [level.heightM, level.dewPointDepressionC]),
  ].filter(([, depression]) => Number.isFinite(depression));
  if (profile.length === 0) {
    return null;
  }
  if (profile[0][1] <= SATURATED_DEPRESSION_C) {
    return profile[0][0];
  }
  for (let index = 1; index < profile.length; index += 1) {
    const [belowM, belowC] = profile[index - 1];
    const [aboveM, aboveC] = profile[index];
    if (aboveC <= SATURATED_DEPRESSION_C) {
      const fraction = (belowC - SATURATED_DEPRESSION_C) / (belowC - aboveC);
      return belowM + fraction * (aboveM - belowM);
    }
  }
  return null;
}

function boundaryLayerDepth(
  surfaceTemperatureC: number,
  modelElevationM: number,
  levels: SourceLevel[],
): number {
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const altitudeAglM = level.heightM - modelElevationM;
    const liftedParcelTemperatureC =
      surfaceTemperatureC - altitudeAglM * DRY_ADIABATIC_LAPSE_C_PER_M;
    if (liftedParcelTemperatureC > level.temperatureC) {
      continue;
    }

    if (index === 0) {
      return Math.max(0.0, altitudeAglM);
    }
    const previous = levels[index - 1];
    const previousAglM = previous.heightM - modelElevationM;
    const lapse = (level.temperatureC - previous.temperatureC) / (level.heightM - previous.heightM);
    const denominator = DRY_ADIABATIC_LAPSE_C_PER_M + lapse;
    if (Math.abs(denominator) < 0.00001) {
      return Math.max(0.0, previousAglM);
    }
    return Math.max(
      0.0,
      (surfaceTemperatureC - previous.temperatureC + lapse * previousAglM) / denominator,
    );
  }

  if (levels.length > 0) {
    return Math.max(0.0, levels[levels.length - 1].heightM - modelElevationM);
  }
  return 0.0;
}

function thermalVelocity(
  surfaceTemperatureC: number,
  sensibleHeatFluxWm2: number,
  latentHeatFluxWm2: number,
  boundaryLayerDepthM: number,
  firstPressureHpa: number | null,
): number {
  if (boundaryLayerDepthM <= 0 || firstPressureHpa === null) {
    return 0.0;
  }
  const surfaceTemperatureK = surfaceTemperatureC + 273.15;
  const virtualHeatFlux =
    sensibleHeatFluxWm2 + 0.000245268 * surfaceTemperatureK * latentHeatFluxWm2;
  if (virtualHeatFlux <= 0) {
    return 0.0;
  }

  const potentialTemperatureK = surfaceTemperatureK * (1015 / firstPressureHpa) ** 0.28482;
  return Math.cbrt((0.0075516 / potentialTemperatureK) * virtualHeatFlux * boundaryLayerDepthM);
}

function clampAltitude(value: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : minimum;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
