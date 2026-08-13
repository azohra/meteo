import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { roundContract } from "@azohra/meteo.briefing/contract";
import { compactJson, writeJson } from "@azohra/meteo.briefing/history";
import { cataloguedModelSlugs, packagedModelsPath } from "./catalogue.js";

export { roundContract, compactJson, writeJson };

const FIELD_DECIMALS: Record<string, number> = {
  aot: 3,
  boundaryLayerTopM: 1,
  byClass: 3,
  capeJkg: 0,
  cinJkg: 0,
  cloudBaseM: 1,
  cloudCoverPercent: 1,
  cloudFractionPercent: 1,
  columnMgm2: 1,
  dewPointC: 2,
  downwardShortwaveWm2: 1,
  elevationM: 1,
  heightM: 1,
  highCloudPercent: 1,
  latentHeatFluxWm2: 1,
  lowCloudPercent: 1,
  maxM: 0,
  midCloudPercent: 1,
  minM: 0,
  modelElevationM: 1,
  pblHeightM: 1,
  percentile: 0,
  pm25Ugm3: 1,
  precipitationMmHr: 2,
  seaLevelPressureHpa: 2,
  sensibleHeatFluxWm2: 1,
  slopeDeg: 1,
  smokePlumeColumnMgm2: 1,
  smokePlumeSurfaceUgm3: 1,
  surfaceUgm3: 1,
  temperatureC: 2,
  thermalVelocityMps: 2,
  usableLiftTopM: 1,
  verticalVelocityPaS: 3,
  windGustMps: 2,
  windSpeedMps: 2,
};

const DEGREE_FIELDS = ["windDirectionDeg", "aspectDeg"] as const;

/**
 * Rounds a published document per the contract's per-field rounding table;
 * unlisted fields publish verbatim.
 */
export function roundDocument(value: unknown, decimals?: number): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => roundDocument(item, decimals));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        (DEGREE_FIELDS as readonly string[]).includes(key)
          ? roundedDegrees(item as number | null)
          : roundDocument(
              item,
              Object.hasOwn(FIELD_DECIMALS, key) ? FIELD_DECIMALS[key] : decimals,
            ),
      ]),
    );
  }
  if (typeof value === "number" && decimals !== undefined) {
    return roundContract(value, decimals);
  }
  return value;
}

function roundedDegrees(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  return ((roundContract(value, 0) % 360) + 360) % 360;
}

/** The pipeline-side view of a download-stats accumulator. */
export interface DownloadStats {
  requests: number;
  responseBytes: number;
  retries: number;
}

/**
 * The manifest's stats block: downloads, downloadBytes, retries, durationMs.
 * `startedAtMs` is a performance.now() timestamp.
 */
export function manifestStats(
  downloadStats: DownloadStats,
  startedAtMs: number,
): Record<string, number> {
  return {
    downloadBytes: downloadStats.responseBytes,
    downloads: downloadStats.requests,
    durationMs: roundContract(performance.now() - startedAtMs, 0),
    retries: downloadStats.retries,
  };
}

/** A published manifest as the runs index reads it. */
export interface PublishedManifest {
  model: string;
  referenceTime: string;
  generatedAt: string;
  [key: string]: unknown;
}

/** Reads one model's published manifest, or null/undefined when the model has never published. */
export type PublishedManifestReader = (slug: string) => PublishedManifest | null | undefined;

/**
 * The cross-model run index runs.json: per published model, the manifest's
 * (referenceTime, generatedAt) pair; a model that has never published is absent.
 */
export function runsIndex(
  modelSlugs: readonly string[],
  publishedManifest: PublishedManifestReader,
): { schemaVersion: number; runs: Record<string, { referenceTime: string; generatedAt: string }> } {
  const runs: Record<string, { referenceTime: string; generatedAt: string }> = {};
  for (const slug of modelSlugs) {
    const manifest = publishedManifest(slug);
    if (manifest === null || manifest === undefined) {
      continue;
    }
    runs[manifest.model] = {
      referenceTime: manifest.referenceTime,
      generatedAt: manifest.generatedAt,
    };
  }
  return { schemaVersion: 1, runs };
}

export function writeRunsIndex(
  publishedManifest: PublishedManifestReader,
  path = "data/runs.json",
  modelsPath = packagedModelsPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeJson(path, runsIndex(cataloguedModelSlugs(modelsPath), publishedManifest), {
    compact: false,
  });
}
