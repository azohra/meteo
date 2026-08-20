import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_SCHEMA_VERSION } from "@azohra/meteo.briefing/contract";
import { publishedHistory, publishedReferenceTime, type DatasetOptions } from "../dataset.js";
import { appendHistory, type ArchivableProfile } from "../history.js";
import { manifestStats, roundDocument, writeJson } from "../publish.js";
import { parseSites, type Site } from "../sites.js";
import { DownloadCounters } from "../providers/transport.js";
import { manifestInstant } from "./common.js";

/** The publication options every run builder shares. */
export interface PublishRunOptions {
  sitesPath: string;
  history?: boolean;
  outputRoot?: string;
  dataset?: DatasetOptions;
  log?: (line: string) => void;
}

/** What a build hands back for publication. */
export interface BuiltRun {
  documents: readonly unknown[];
  firstForecastHour: number;
  forecastHours: number;
  lastForecastHour: number;
}

/** The model-specific parts of one run publication. */
export interface RunPublication {
  slug: string;
  /** The display name log lines carry — "HRRR", "GEPS", or the slug itself. */
  label: string;
  /** What the published count names — "profiles", "ensemble documents". */
  publishedNoun: string;
  /**
   * Resolve the run to build: validate a pinned reference time or probe the
   * feed. Null means no complete run exists; internal run tokens stay in the
   * builder's closure.
   */
  resolveRun: () => Promise<string | null>;
  /** Override for the "Building …" line when the default lacks a fact. */
  buildingLine?: (referenceTime: string, siteCount: number) => string;
  /** Extra manifest entries, spread in the manifest's alphabetical position. */
  manifestExtras?: Record<string, unknown>;
  build: (
    referenceTime: string,
    sites: readonly Site[],
    stats: DownloadCounters,
  ) => Promise<BuiltRun>;
}

/**
 * The shared tail of every run builder: resolve the run, skip an
 * already-published reference time, build, write the site documents and
 * history archives, write the manifest, and report. Builders supply only
 * the model-specific parts; none open-codes these writes.
 */
export async function publishRun(
  publication: RunPublication,
  options: PublishRunOptions,
): Promise<boolean> {
  const log = options.log ?? ((line: string) => console.log(line));
  const outputRoot = options.outputRoot ?? "data";
  const sites = parseSites(readFileSync(options.sitesPath, "utf-8"), options.sitesPath);

  const referenceTime = await publication.resolveRun();
  if (referenceTime === null) {
    log(`No complete ${publication.label} run is available.`);
    return false;
  }
  if ((await publishedReferenceTime(publication.slug, options.dataset)) === referenceTime) {
    log(`${publication.label} run ${referenceTime} is already published.`);
    return false;
  }

  log(
    publication.buildingLine?.(referenceTime, sites.length) ??
      `Building ${publication.label} ${referenceTime} for ${sites.length} sites…`,
  );
  const startedAt = performance.now();
  const stats = new DownloadCounters();
  const result = await publication.build(referenceTime, sites, stats);

  const outDir = join(outputRoot, publication.slug);
  const sitesDir = join(outDir, "sites");
  mkdirSync(sitesDir, { recursive: true });
  const month = referenceTime.slice(0, 7);
  for (const raw of result.documents) {
    const document = roundDocument(raw) as ArchivableProfile;
    writeJson(join(sitesDir, `${document.site.id}.json`), document, { compact: true });
    if (options.history ?? true) {
      const published = await publishedHistory(
        publication.slug,
        document.site.id,
        month,
        options.dataset,
      );
      appendHistory(document, join(outDir, "history"), () => published);
    }
  }
  const manifest = {
    firstForecastHour: result.firstForecastHour,
    forecastHours: result.forecastHours,
    generatedAt: manifestInstant(),
    lastForecastHour: result.lastForecastHour,
    ...(publication.manifestExtras ?? {}),
    model: publication.slug,
    referenceTime,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    sites: sites.map((site) => ({ name: site.name, slug: site.slug })),
    stats: manifestStats(stats, startedAt),
  };
  writeJson(join(outDir, "manifest.json"), manifest, { compact: false });
  log(
    `Published ${result.documents.length} ${publication.publishedNoun} for ${referenceTime} ` +
      `(${stats.requests} downloads, ${Math.floor(stats.responseBytes / (1024 * 1024))} MiB).`,
  );
  for (const line of stats.transportReport()) {
    log(line);
  }
  return true;
}
