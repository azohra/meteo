import type { EnsembleValue, ForecastHour, SiteForecast } from "../src/contract.js";

const FLOOR_M = 1072.5;

export const SCENE_LAUNCH = { elevationM: 1485 } as const;

const LEVEL_PRESSURES = [925, 900, 875, 850, 800];
const LEVEL_HEIGHTS = [1252.4, 1494.1, 1741.6, 1996.2, 2531.7];

function isoHour(startIso: string, offset: number): string {
  return new Date(Date.parse(startIso) + offset * 3_600_000).toISOString().replace(".000Z", "Z");
}

export function deterministicSceneProfile(): SiteForecast {
  const wStar = [0, 0.4, 0.9, 1.5, 2.0, 2.4, 2.2, 1.8];
  const hours: ForecastHour[] = wStar.map((thermalVelocityMps, h) => {
    const surfaceTemperatureC = 8 + 2 * h;
    return {
      validAt: isoHour("2026-08-09T14:00:00Z", h),
      surface: {
        seaLevelPressureHpa: 1013 - h * 0.4,
        temperatureC: surfaceTemperatureC,
        dewPointC: surfaceTemperatureC - (10 - h * 0.5),
        windSpeedMps: 1 + h * 0.4,
        windDirectionDeg: 220 + h,
        cloudCoverPercent: 10 + h * 5,
        precipitationMmHr: h < 6 ? 0 : 0.2,
        sensibleHeatFluxWm2: h * 50,
        latentHeatFluxWm2: 60,
      },
      levels: (() => {
        const layerRates = [0.011, 0.011, 0.008, 0.006, 0.005];
        let previousHeightM = FLOOR_M;
        let temperatureC = surfaceTemperatureC;
        return LEVEL_PRESSURES.map((pressureHpa, i) => {
          const heightM = LEVEL_HEIGHTS[i] + h * 2;
          temperatureC -= (heightM - previousHeightM) * layerRates[i];
          previousHeightM = heightM;
          const depressionC = Math.max(0.2, 8 - i * 2 - h * 0.3);
          return {
            pressureHpa,
            heightM,
            temperatureC,
            dewPointC: temperatureC - depressionC,
            windSpeedMps: 1.5 + i * 1.5 + h * 0.1,
            windDirectionDeg: 200 + i * 15 + h,
            verticalVelocityPaS: -0.4 + i * 0.15,
          };
        });
      })(),
      derived: {
        boundaryLayerTopM: h === 0 ? null : 1200 + h * 300 + (h % 2) * 80,
        thermalVelocityMps,
        cloudBaseM: 2600 + h * 150,
        usableLiftTopM: h < 2 ? null : 1400 + h * 280 + (h % 2) * 90,
      },
    };
  });

  return {
    schemaVersion: 2,
    model: "hrdps-continental",
    run: { referenceTime: "2026-08-09T00:00:00Z", generatedAt: "2026-08-09T04:47:14Z" },
    site: {
      id: "dundee",
      name: "Dundee",
      latitude: 49.291977,
      longitude: -117.183569,
      modelElevationM: FLOOR_M,
    },
    hours,
  };
}

function ens(median: number, spread: number, ceiledMembers?: number): EnsembleValue {
  const value: EnsembleValue = {
    members: 21,
    p10: median - 1.5 * spread,
    p25: median - spread,
    p50: median,
    p75: median + spread,
    p90: median + 1.5 * spread,
  };
  if (ceiledMembers !== undefined) value.ceiledMembers = ceiledMembers;
  return value;
}

export function ensembleSceneProfile(): SiteForecast {
  const hours: ForecastHour[] = Array.from({ length: 6 }, (_, h) => ({
    validAt: isoHour("2026-08-09T16:00:00Z", h),
    surface: {
      seaLevelPressureHpa: ens(1012 - h * 0.3, 0.6),
      temperatureC: ens(16 + 2 * h, 0.8),
      dewPointC: ens(6 + h * 0.5, 0.6),
      windSpeedMps: ens(2 + h * 0.5, 0.5),
      windDirectionDeg: ens(240 + h, 8),
      cloudCoverPercent: ens(20 + h * 8, 10),
      precipitationMmHr: ens(0, 0),
      sensibleHeatFluxWm2: ens(80 + h * 40, 25),
      latentHeatFluxWm2: ens(70, 15),
    },
    levels: [],
    derived: {
      boundaryLayerTopM: h === 0 ? null : ens(1400 + h * 320, 180, 0),
      thermalVelocityMps: ens(0.3 + h * 0.35, 0.2),
      cloudBaseM: ens(2500 + h * 120, 220),
      usableLiftTopM: h < 2 ? null : ens(1600 + h * 300, 250, 1),
    },
  }));

  return {
    schemaVersion: 2,
    model: "reps",
    run: { referenceTime: "2026-08-09T00:00:00Z", generatedAt: "2026-08-09T05:58:33Z" },
    site: {
      id: "dundee",
      name: "Dundee",
      latitude: 49.291977,
      longitude: -117.183569,
      modelElevationM: 1573.9,
    },
    hours,
  };
}

export function scienceSceneProfile(): SiteForecast {
  const capeByHour = [120, 450, 950, 1700, 650, 90];
  const cinByHour = [-5, -80, -15, -120, -30, 0];
  const base = deterministicSceneProfile();
  const hours: ForecastHour[] = capeByHour.map((capeJkg, h) => {
    const template = base.hours[h];
    return {
      ...template,
      surface: {
        ...template.surface,
        windGustMps: 6 + h * 1.5,
        capeJkg,
        cinJkg: cinByHour[h],
        pblHeightM: 400 + h * 350,
        lowCloudPercent: h * 12,
        midCloudPercent: h < 4 ? 5 + h * 20 : 90,
        highCloudPercent: h === 0 ? 0 : 40,
      },
      levels: template.levels.map((level, index) =>
        h >= 3 ? { ...level, cloudFractionPercent: index >= 3 ? 90 : 10 } : { ...level },
      ),
    };
  });
  return { ...base, model: "gfs", hours };
}

export function tinySceneProfile(): SiteForecast {
  const hour = (validAt: string, surfaceTemperatureC: number): ForecastHour => ({
    validAt,
    surface: {
      seaLevelPressureHpa: 1010,
      temperatureC: surfaceTemperatureC,
      dewPointC: surfaceTemperatureC - 10,
      windSpeedMps: 0,
      windDirectionDeg: 0,
      cloudCoverPercent: 0,
      precipitationMmHr: 0,
      sensibleHeatFluxWm2: 100,
      latentHeatFluxWm2: 50,
    },
    levels: [
      {
        pressureHpa: 850,
        heightM: 2000,
        temperatureC: 10,
        dewPointC: 0,
        windSpeedMps: 10,
        windDirectionDeg: 270,
      },
      {
        pressureHpa: 700,
        heightM: 3000,
        temperatureC: 2,
        dewPointC: -10,
        windSpeedMps: 10,
        windDirectionDeg: 270,
      },
    ],
    derived: {
      boundaryLayerTopM: 2500,
      thermalVelocityMps: 1.5,
      cloudBaseM: 2210,
      usableLiftTopM: 2400,
    },
  });
  return {
    schemaVersion: 2,
    model: "hrdps-continental",
    run: { referenceTime: "2026-08-09T00:00:00Z", generatedAt: "2026-08-09T04:00:00Z" },
    site: {
      id: "tiny",
      name: "Tiny",
      latitude: 49,
      longitude: -117,
      modelElevationM: 1000,
    },
    hours: [hour("2026-08-09T18:00:00Z", 20), hour("2026-08-09T19:00:00Z", 22)],
  };
}
