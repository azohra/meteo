import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifestJson } from "@azohra/meteo.briefing/contract";
import { documentPaths } from "@azohra/meteo.briefing/transport";
import { cataloguedModelSlugs, packagedModelsPath } from "./catalogue.js";
import { PublisherConfigurationError } from "./config.js";
import {
  fetchPublished,
  prefetchedManifestReader,
  publishedManifest,
  RETRYABLE_S3_CODES,
  s3ErrorCode,
  s3Mode,
  s3ObjectName,
  signedS3Fetch,
  type DatasetOptions,
} from "./dataset.js";
import { transportBackoff } from "./providers/transport.js";
import { writeRunsIndex } from "./publish.js";

/* Upload order: history archives, then site profiles, then the manifest
   (the publication's commit point; nothing it references may appear after
   it), then runs.json last, regenerated from the published manifests so
   concurrent lanes converge on whoever writes it last. Every key comes
   from the reader contract's documentPaths; this module spells no path. */

/* Cache lifetimes are operator-chosen to match a deployment's tick and
   CDN. A closed month archive never changes again, so closedMonths may
   safely be immutable; everything else changes with the next run. The
   TRIAL defaults suit a 15-minute tick and are caller-movable. */
export interface CacheLifetimes {
  /** Objects the next run replaces: manifests, site documents, open months, runs.json. TRIAL default "public, max-age=300". */
  live?: string;
  /** Month archives that can no longer receive an append. TRIAL default "public, max-age=31536000, immutable". */
  closedMonths?: string;
}

const TRIAL_LIVE_TTL = "public, max-age=300";
const TRIAL_CLOSED_TTL = "public, max-age=31536000, immutable";
const JSON_TYPE = "application/json";
const GZIP_TYPE = "application/gzip";

/** One object of a publication, in upload order. */
export interface PlannedUpload {
  path: string;
  key: string;
  cacheControl: string;
  contentType: string;
}

/* A month archive closes when no run with a referenceTime in that month
   can still arrive. A run started just before a month boundary appends to
   the previous month after it, so the previous month stays on the short
   TTL too; anything older is genuinely closed. */
export function openMonths(now: Date): { current: string; previous: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previous = new Date(first.getTime() - 86_400_000);
  const month = (date: Date) => date.toISOString().slice(0, 7);
  return { current: month(first), previous: month(previous) };
}

/**
 * The ordered upload plan for one model's freshly built scratch tree:
 * open-month archives, their indexes, closed-month archives, their
 * indexes, site documents, and the manifest last. Pure — walks the local
 * tree and the clock, moves no bytes.
 */
export function publishPlan(
  modelSlug: string,
  dataRoot: string,
  now: Date,
  lifetimes: CacheLifetimes = {},
): PlannedUpload[] {
  const liveTtl = lifetimes.live ?? TRIAL_LIVE_TTL;
  const closedTtl = lifetimes.closedMonths ?? TRIAL_CLOSED_TTL;
  const modelRoot = join(dataRoot, modelSlug);
  const open = openMonths(now);
  const isOpen = (month: string) => month === open.current || month === open.previous;

  const openArchives: PlannedUpload[] = [];
  const openIndexes: PlannedUpload[] = [];
  const closedArchives: PlannedUpload[] = [];
  const closedIndexes: PlannedUpload[] = [];
  const historyRoot = join(modelRoot, "history");
  if (existsSync(historyRoot)) {
    for (const site of readdirSync(historyRoot).sort()) {
      for (const file of readdirSync(join(historyRoot, site)).sort()) {
        const path = join(historyRoot, site, file);
        if (file.endsWith(".jsonl.gz")) {
          const month = file.slice(0, -".jsonl.gz".length);
          (isOpen(month) ? openArchives : closedArchives).push({
            path,
            key: documentPaths.history(modelSlug, site, month),
            cacheControl: isOpen(month) ? liveTtl : closedTtl,
            contentType: GZIP_TYPE,
          });
        } else if (file.endsWith(".index.json")) {
          const month = file.slice(0, -".index.json".length);
          (isOpen(month) ? openIndexes : closedIndexes).push({
            path,
            key: documentPaths.historyIndex(modelSlug, site, month),
            cacheControl: isOpen(month) ? liveTtl : closedTtl,
            contentType: JSON_TYPE,
          });
        }
      }
    }
  }

  const sites: PlannedUpload[] = [];
  const sitesRoot = join(modelRoot, "sites");
  if (existsSync(sitesRoot)) {
    for (const file of readdirSync(sitesRoot).sort()) {
      if (!file.endsWith(".json")) continue;
      sites.push({
        path: join(sitesRoot, file),
        key: documentPaths.siteDocument(modelSlug, file.slice(0, -".json".length)),
        cacheControl: liveTtl,
        contentType: JSON_TYPE,
      });
    }
  }

  return [
    ...openArchives,
    ...openIndexes,
    ...closedArchives,
    ...closedIndexes,
    ...sites,
    {
      path: join(modelRoot, "manifest.json"),
      key: documentPaths.manifest(modelSlug),
      cacheControl: liveTtl,
      contentType: JSON_TYPE,
    },
  ];
}

export type PublishVerdict =
  | { verdict: "nothing" }
  | { verdict: "stale" }
  | { verdict: "would-publish"; objects: number }
  | { verdict: "published"; objects: number };

export interface PublishOptions extends DatasetOptions {
  dataRoot?: string;
  now?: () => Date;
  cacheLifetimes?: CacheLifetimes;
  /** Compute the verdict and the plan without moving a byte. */
  dryRun?: boolean;
}

/**
 * Publishes one model's scratch tree to the dataset bucket: skips without a
 * local manifest (the builder writes nothing when the published run is
 * current), refuses to publish backwards (a scratch tree older than the
 * published dataset must not overwrite newer objects; an unreachable bucket
 * throws rather than reading as either verdict), uploads in plan order, and
 * advances runs.json.
 */
function requireS3Mode(): void {
  if (!s3Mode()) {
    throw new PublisherConfigurationError(
      "publishing needs the authenticated S3 endpoint: set METEO_S3_ENDPOINT " +
        "(R2_ENDPOINT is honored as an alias), AWS_ACCESS_KEY_ID, " +
        "AWS_SECRET_ACCESS_KEY, and METEO_R2_BUCKET, and leave " +
        "METEO_DATA_BASE unset — the public base cannot accept writes",
    );
  }
}

export async function publishModel(
  modelSlug: string,
  options: PublishOptions = {},
): Promise<PublishVerdict> {
  requireS3Mode();
  const dataRoot = options.dataRoot ?? "data";
  const manifestPath = join(dataRoot, modelSlug, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { verdict: "nothing" };
  }
  const local = JSON.parse(readFileSync(manifestPath, "utf-8")) as { generatedAt: string };
  const published = await publishedManifest(modelSlug, options);
  if (published !== null && published.generatedAt >= local.generatedAt) {
    return { verdict: "stale" };
  }

  const now = options.now ?? (() => new Date());
  const plan = publishPlan(modelSlug, dataRoot, now(), options.cacheLifetimes);
  if (options.dryRun) {
    return { verdict: "would-publish", objects: plan.length + 1 };
  }
  for (const upload of plan) {
    await putObject(upload.key, readFileSync(upload.path), upload, options);
  }

  // Read-back canary: the publication must parse with the reader's guard the
  // moment it lands, so a writer/reader break surfaces here — in the
  // publishing job's log — instead of in some consumer's ingest later.
  const echoed = await fetchPublished(documentPaths.manifest(modelSlug), options);
  const parsed = echoed === null ? null : parseManifestJson(new TextDecoder().decode(echoed));
  if (parsed === null || parsed.generatedAt !== local.generatedAt) {
    throw new Error(
      `published ${modelSlug} manifest failed read-back: the object just ` +
        "uploaded does not parse with the reader contract's guard (or is " +
        "not the one uploaded) — the publication is not consumable",
    );
  }

  const runsPath = join(dataRoot, "runs.json");
  const reader = await prefetchedManifestReader(cataloguedModelSlugs(), options);
  writeRunsIndex(reader, runsPath);
  await putObject(
    documentPaths.runs(),
    readFileSync(runsPath),
    { cacheControl: options.cacheLifetimes?.live ?? TRIAL_LIVE_TTL, contentType: JSON_TYPE },
    options,
  );
  return { verdict: "published", objects: plan.length + 1 };
}

/**
 * Publishes the packaged model catalogue — models.json at the dataset
 * root, the engine's own declaration of what it builds. sites.json and
 * site-context.json are NOT published here: the site catalogue is the
 * deployment owner's write, and the context follows the terrain verbs.
 */
export async function publishModels(options: PublishOptions = {}): Promise<void> {
  requireS3Mode();
  await putObject(
    documentPaths.models(),
    readFileSync(packagedModelsPath()),
    { cacheControl: options.cacheLifetimes?.live ?? TRIAL_LIVE_TTL, contentType: JSON_TYPE },
    options,
  );
}

/** Publishes freshly generated site-context bytes to the dataset root. */
export async function publishSiteContext(
  bytes: Uint8Array,
  options: PublishOptions = {},
): Promise<void> {
  requireS3Mode();
  await putObject(
    documentPaths.siteContext(),
    bytes,
    { cacheControl: options.cacheLifetimes?.live ?? TRIAL_LIVE_TTL, contentType: JSON_TYPE },
    options,
  );
}

async function putObject(
  key: string,
  body: Uint8Array,
  headers: { cacheControl: string; contentType: string },
  options: DatasetOptions,
): Promise<void> {
  // Copied into a fresh ArrayBuffer so the bytes satisfy BodyInit regardless
  // of the source buffer's backing store.
  const bytes = new Uint8Array(body);
  const init = {
    method: "PUT" as const,
    headers: {
      "cache-control": headers.cacheControl,
      "content-type": headers.contentType,
    },
    body: bytes,
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let exchange: { status: number; payload: Uint8Array } | null = null;
    try {
      exchange = await signedS3Fetch(key, init, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (exchange !== null) {
      if (exchange.status === 200) return;
      const code = s3ErrorCode(exchange.payload);
      if (!RETRYABLE_S3_CODES.has(code ?? "") && exchange.status < 500) {
        throw new Error(`PUT ${s3ObjectName(key)} failed with ${code ?? exchange.status}`);
      }
      lastError = new Error(`PUT ${s3ObjectName(key)} failed with ${code ?? exchange.status}`);
    }
    if (attempt < 2) {
      await transportBackoff(attempt, options);
    }
  }
  throw lastError!;
}
