import type { EnsembleValue, ForecastHour, SiteForecast } from "../src/contract.js";

/* Controlled columns for the sounding suite. Parcel physics is NOT
   load-bearing in the tests these feed: the columns are chosen so any
   correct parcel implementation gives the asserted output, and lane A1's
   authoritative parcelAscent replaces the placeholder without moving them. */

/** Env follows the dry adiabat from the surface with negligible moisture: any correct parcel matches the environment. */
export function dryNeutralProfile(): SiteForecast {
  const floorM = 1000;
  const surfaceTemperatureC = 20;
  const heights = [1500, 2000, 2500, 3000, 3500];
  const hour: ForecastHour = {
    validAt: "2026-08-09T18:00:00Z",
    surface: {
      seaLevelPressureHpa: 1012,
      temperatureC: surfaceTemperatureC,
      dewPointC: surfaceTemperatureC - 40,
      windSpeedMps: 3,
      windDirectionDeg: 270,
      cloudCoverPercent: 0,
      precipitationMmHr: 0,
      sensibleHeatFluxWm2: 200,
      latentHeatFluxWm2: 40,
    },
    levels: heights.map((heightM, index) => {
      const temperatureC = surfaceTemperatureC - 0.0098 * (heightM - floorM);
      return {
        pressureHpa: 900 - index * 50,
        heightM,
        temperatureC,
        dewPointC: temperatureC - 40,
        windSpeedMps: 4 + index,
        windDirectionDeg: 270,
      };
    }),
    derived: {
      boundaryLayerTopM: 3200,
      thermalVelocityMps: 2,
      cloudBaseM: 3400,
      usableLiftTopM: 3100,
    },
  };
  return {
    schemaVersion: 2,
    model: "hrdps-continental",
    run: { referenceTime: "2026-08-09T00:00:00Z", generatedAt: "2026-08-09T04:00:00Z" },
    site: {
      id: "dry-neutral",
      name: "Dry Neutral",
      latitude: 49,
      longitude: -117,
      modelElevationM: floorM,
    },
    hours: [hour],
  };
}

/** Isothermal cold column above a warm surface: any correct parcel is colder than the environment aloft. */
export function isothermalProfile(): SiteForecast {
  const base = dryNeutralProfile();
  const hour = base.hours[0];
  return {
    ...base,
    site: { ...base.site, id: "isothermal", name: "Isothermal" },
    hours: [
      {
        ...hour,
        levels: hour.levels.map((level) => ({
          ...level,
          temperatureC: 20,
          dewPointC: -20,
        })),
      },
    ],
  };
}

function ens(median: number, spread: number): EnsembleValue {
  return {
    members: 9,
    p10: median - 1.5 * spread,
    p25: median - spread,
    p50: median,
    p75: median + spread,
    p90: median + 1.5 * spread,
  };
}

/** A 5-level ensemble column: the sparse-column stress case. */
export function ensembleLevelsProfile(): SiteForecast {
  const floorM = 900;
  const heights = [1100, 1600, 2100, 2600, 3100];
  const hour: ForecastHour = {
    validAt: "2026-08-09T20:00:00Z",
    surface: {
      seaLevelPressureHpa: ens(1011, 0.6),
      temperatureC: ens(24, 1),
      dewPointC: ens(9, 1),
      windSpeedMps: ens(2.5, 0.5),
      windDirectionDeg: ens(200, 8),
      cloudCoverPercent: ens(20, 10),
      precipitationMmHr: ens(0, 0),
      sensibleHeatFluxWm2: ens(220, 30),
      latentHeatFluxWm2: ens(70, 15),
    },
    levels: heights.map((heightM, index) => ({
      pressureHpa: 925 - index * 50,
      heightM: ens(heightM, 0),
      temperatureC: ens(24 - 0.008 * (heightM - floorM), 1.2),
      dewPointC: ens(9 - 0.002 * (heightM - floorM), 1.4),
      windSpeedMps: ens(3 + index, 0.8),
      windDirectionDeg: ens(210 + index * 5, 10),
    })),
    derived: {
      boundaryLayerTopM: ens(2600, 250),
      thermalVelocityMps: ens(1.9, 0.3),
      cloudBaseM: ens(2900, 300),
      usableLiftTopM: ens(2700, 260),
    },
  };
  return {
    schemaVersion: 2,
    model: "reps",
    run: {
      referenceTime: "2026-08-09T00:00:00Z",
      generatedAt: "2026-08-09T05:00:00Z",
      members: 9,
    },
    site: {
      id: "ensemble-column",
      name: "Ensemble Column",
      latitude: 49,
      longitude: -117,
      modelElevationM: floorM,
    },
    hours: [hour],
  };
}
