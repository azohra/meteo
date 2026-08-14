import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSiteForecast,
  type EnsembleValue,
  type ModelCatalogue,
  type RunsIndex,
  type SitesCatalogue,
  type ForecastHour,
  type ForecastManifest,
  type ObservationManifest,
  type SiteForecast,
} from "../src/contract.js";

/* analyze-fixtures.json holds real pipeline profiles (36-45 kB each); the
   file is read once and each key is contract-parsed once. Callers get a
   deep clone, so a mutating test never leaks into the next. */
let analyzeFixturesJson: Record<string, unknown> | undefined;
const parsedAnalyzeFixtures = new Map<string, SiteForecast>();

function analyzeFixturesDocument(): Record<string, unknown> {
  analyzeFixturesJson ??= JSON.parse(
    readFileSync(join(__dirname, "analyze-fixtures.json"), "utf-8"),
  ) as Record<string, unknown>;
  return analyzeFixturesJson;
}

/** A deep clone of the raw fixture document, for tests that mutate and re-parse. */
export function analyzeFixtureRaw(key: string): unknown {
  return structuredClone(analyzeFixturesDocument()[key]);
}

/** A deep clone of the contract-parsed fixture profile. */
export function analyzeFixture(key: string): SiteForecast {
  let profile = parsedAnalyzeFixtures.get(key);
  if (profile === undefined) {
    const parsed = parseSiteForecast(analyzeFixturesDocument()[key]);
    if (parsed === null) throw new Error(`${key} must satisfy the published contract`);
    parsedAnalyzeFixtures.set(key, parsed);
    profile = parsed;
  }
  return structuredClone(profile);
}

export function deterministicHour(overrides: Partial<ForecastHour> = {}): ForecastHour {
  return {
    validAt: "2026-08-09T00:00:00Z",
    surface: {
      seaLevelPressureHpa: 1010.71,
      temperatureC: 28.28,
      dewPointC: 4.72,
      windSpeedMps: 1.47,
      windDirectionDeg: 246,
      cloudCoverPercent: 9.2,
      precipitationMmHr: 0,
      sensibleHeatFluxWm2: 310.4,
      latentHeatFluxWm2: 95.1,
    },
    levels: [
      {
        pressureHpa: 875,
        heightM: 1252.4,
        temperatureC: 25.74,
        dewPointC: 2.17,
        windSpeedMps: 2.99,
        windDirectionDeg: 245,
      },
    ],
    derived: {
      boundaryLayerTopM: 3223.1,
      thermalVelocityMps: 1.63,
      cloudBaseM: 4145.1,
      usableLiftTopM: 3585.0,
    },
    ...overrides,
  };
}

export function deterministicProfile(overrides: Partial<SiteForecast> = {}): SiteForecast {
  return {
    schemaVersion: 2,
    model: "hrdps-continental",
    run: {
      referenceTime: "2026-08-08T00:00:00Z",
      generatedAt: "2026-08-08T04:47:14Z",
    },
    site: {
      id: "dundee",
      name: "Dundee",
      latitude: 49.291977,
      longitude: -117.183569,
      modelElevationM: 1072.5,
    },
    hours: [deterministicHour()],
    ...overrides,
  };
}

type PopulatedEnsemble = Extract<EnsembleValue, { p50: number }>;

export function ensembleValue(overrides: Partial<PopulatedEnsemble> = {}): EnsembleValue {
  return { members: 21, p10: 0, p25: 0.3, p50: 1.3, p75: 3.7, p90: 9.4, ...overrides };
}

export function ensembleProfile(): SiteForecast {
  return deterministicProfile({
    model: "reps",
    run: {
      referenceTime: "2026-08-08T00:00:00Z",
      generatedAt: "2026-08-08T04:47:14Z",
      members: 21,
    },
    hours: [
      deterministicHour({
        surface: {
          seaLevelPressureHpa: ensembleValue({ p50: 1011.21 }),
          temperatureC: ensembleValue({ p50: 21.69 }),
          dewPointC: ensembleValue({ p50: 4.1 }),
          windSpeedMps: ensembleValue({ p50: 1.3 }),
          windDirectionDeg: ensembleValue({ p50: 246 }),
          cloudCoverPercent: ensembleValue({ p50: 6.75 }),
          precipitationMmHr: ensembleValue({ p50: 0 }),
          sensibleHeatFluxWm2: ensembleValue({ p50: 210.4 }),
          latentHeatFluxWm2: ensembleValue({ p50: 80.2 }),
        },
        levels: [],
        derived: {
          boundaryLayerTopM: ensembleValue({ p50: 3556.4, ceiledMembers: 0 }),
          thermalVelocityMps: ensembleValue({ p50: 2.33 }),
          cloudBaseM: ensembleValue({ p50: 3595.0 }),
          usableLiftTopM: ensembleValue({ p50: 3595.0, ceiledMembers: 0 }),
        },
      }),
    ],
  });
}

export function manifest(): ForecastManifest {
  return {
    schemaVersion: 1,
    model: "hrdps-continental",
    referenceTime: "2026-08-08T00:00:00Z",
    generatedAt: "2026-08-08T04:47:14.561Z",
    firstForecastHour: 14,
    lastForecastHour: 48,
    forecastHours: 26,
    sites: [
      { name: "Dundee", slug: "dundee" },
      { name: "Red Mtn", slug: "red-mountain" },
    ],
    stats: {
      downloads: 1406,
      downloadBytes: 5190709,
      retries: 0,
      durationMs: 129427,
      geoMetCoverageProbes: 12,
    },
  };
}

export function observationManifest(): ObservationManifest {
  return {
    schemaVersion: 1,
    model: "goes18-aod",
    referenceTime: "2026-08-10T21:56:24Z",
    generatedAt: "2026-08-10T22:01:07.114Z",
    firstObservedAt: "2026-08-08T22:01:24Z",
    lastObservedAt: "2026-08-10T21:56:24Z",
    observationCount: 574,
    sites: [
      { name: "Dundee", slug: "dundee" },
      { name: "Erie", slug: "erie" },
    ],
    stats: {
      downloads: 12,
      downloadBytes: 48211,
      retries: 0,
      durationMs: 8112,
    },
  };
}

export function sitesCatalogue(): SitesCatalogue {
  return {
    schemaVersion: 2,
    sites: [
      {
        slug: "dundee",
        name: "Dundee",
        latitude: 49.291977,
        longitude: -117.183569,
        timeZone: "America/Vancouver",
      },
      {
        slug: "red-mountain",
        name: "Red Mtn",
        latitude: 49.091868,
        longitude: -117.820838,
        timeZone: "America/Vancouver",
      },
    ],
  };
}

export function runsIndex(): RunsIndex {
  return {
    schemaVersion: 1,
    runs: {
      "hrdps-continental": {
        referenceTime: "2026-08-08T00:00:00Z",
        generatedAt: "2026-08-08T04:47:14Z",
      },
      reps: {
        referenceTime: "2026-08-07T12:00:00Z",
        generatedAt: "2026-08-07T17:03:41Z",
      },
    },
  };
}

export function catalogue(): ModelCatalogue {
  return {
    schemaVersion: 1,
    models: [
      {
        slug: "hrdps-continental",
        label: "HRDPS continental",
        provider: "ECCC",
        gridKm: 2.5,
        stepHours: 1,
        horizonHours: 48,
        runIntervalHours: 6,
        typicalPublicationLagHours: 4.5,
        kind: "deterministic",
        experimental: false,
        capabilities: {
          levels: true,
          pressureLevels: [925, 900, 875, 850, 800, 750, 700, 650, 600],
          verticalVelocity: false,
          heatFluxes: true,
          gust: "hourMax",
          precipitation: "instantRate",
          cape: true,
          cin: false,
          pblHeight: true,
          cloudLayers: false,
          cloudProfile: false,
          smoke: false,
        },
      },
      {
        slug: "reps",
        label: "REPS",
        provider: "ECCC",
        gridKm: 10,
        stepHours: 1,
        horizonHours: 72,
        runIntervalHours: 6,
        typicalPublicationLagHours: 4.5,
        kind: "ensemble",
        experimental: false,
        capabilities: {
          levels: false,
          pressureLevels: [],
          verticalVelocity: false,
          heatFluxes: true,
          gust: false,
          precipitation: "instantRate",
          cape: false,
          cin: false,
          pblHeight: false,
          cloudLayers: false,
          cloudProfile: false,
          smoke: false,
        },
      },
    ],
  };
}
