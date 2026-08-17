import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import { documentPaths } from "@azohra/meteo.briefing/transport";
import { cataloguedModelSlugs } from "./catalogue.js";
import { PublisherConfigurationError } from "./config.js";
import {
  prefetchedManifestReader,
  publishedManifest,
  s3Mode,
  type DatasetOptions,
} from "./dataset.js";
import { writeRunsIndex } from "./publish.js";
import { REQUEST_TIMEOUT_S } from "./providers/transport.js";

/* Publishing a model is an ordered upload, and the order is the protocol:
   history archives before site profiles before the manifest — the manifest
   is the publication's commit point, so nothing it references appears
   after it — and runs.json advances last, regenerated from the *published*
   manifests so concurrent lanes converge on whoever writes it last.
   Every key comes from the reader contract's documentPaths: the layout has
   one home, and this module never spells a path. */

const SHORT_TTL = "public, max-age=300";
const CLOSED_TTL = "public, max-age=31536000, immutable";
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
export function publishPlan(modelSlug: string, dataRoot: string, now: Date): PlannedUpload[] {
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
            cacheControl: isOpen(month) ? SHORT_TTL : CLOSED_TTL,
            contentType: GZIP_TYPE,
          });
        } else if (file.endsWith(".index.json")) {
          const month = file.slice(0, -".index.json".length);
          (isOpen(month) ? openIndexes : closedIndexes).push({
            path,
            key: documentPaths.historyIndex(modelSlug, site, month),
            cacheControl: isOpen(month) ? SHORT_TTL : CLOSED_TTL,
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
        cacheControl: SHORT_TTL,
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
      cacheControl: SHORT_TTL,
      contentType: JSON_TYPE,
    },
  ];
}

export type PublishVerdict =
  | { verdict: "nothing" }
  | { verdict: "stale" }
  | { verdict: "published"; objects: number };

export interface PublishOptions extends DatasetOptions {
  dataRoot?: string;
  now?: () => Date;
}

const RETRYABLE_S3_CODES = new Set([
  "InternalError",
  "RequestTimeout",
  "ServiceUnavailable",
  "SlowDown",
  "Throttling",
  "ThrottlingException",
]);

/**
 * Publishes one model's scratch tree to the dataset bucket: skips without a
 * local manifest (the builder writes nothing when the published run is
 * current), refuses to publish backwards (a scratch tree older than the
 * published dataset must not overwrite newer objects; an unreachable bucket
 * throws rather than reading as either verdict), uploads in plan order, and
 * advances runs.json.
 */
export async function publishModel(
  modelSlug: string,
  options: PublishOptions = {},
): Promise<PublishVerdict> {
  if (!s3Mode()) {
    throw new PublisherConfigurationError(
      "publishing needs the authenticated S3 endpoint: set R2_ENDPOINT, " +
        "AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and METEO_R2_BUCKET, and " +
        "leave METEO_DATA_BASE unset — the public base cannot accept writes",
    );
  }
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
  const plan = publishPlan(modelSlug, dataRoot, now());
  for (const upload of plan) {
    await putObject(upload.key, readFileSync(upload.path), upload, options);
  }

  const runsPath = join(dataRoot, "runs.json");
  const reader = await prefetchedManifestReader(cataloguedModelSlugs(), options);
  writeRunsIndex(reader, runsPath);
  await putObject(
    documentPaths.runs(),
    readFileSync(runsPath),
    { cacheControl: SHORT_TTL, contentType: JSON_TYPE },
    options,
  );
  return { verdict: "published", objects: plan.length + 1 };
}

async function putObject(
  key: string,
  body: Uint8Array,
  headers: { cacheControl: string; contentType: string },
  options: DatasetOptions,
): Promise<void> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const endpoint = (process.env["R2_ENDPOINT"] ?? "").replace(/\/+$/, "");
  const bucket = process.env["METEO_R2_BUCKET"];
  if (!bucket) {
    throw new PublisherConfigurationError(
      "publishing needs METEO_R2_BUCKET to name the dataset bucket",
    );
  }
  const client = new AwsClient({
    accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "",
    service: "s3",
    region: "auto",
  });
  const url = `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  // Copied into a fresh ArrayBuffer so the bytes satisfy BodyInit regardless
  // of the source buffer's backing store.
  const bytes = new Uint8Array(body);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const signed = await client.sign(url, {
      method: "PUT",
      headers: {
        "cache-control": headers.cacheControl,
        "content-type": headers.contentType,
      },
      body: bytes,
    });
    let status: number | null = null;
    let payload: Uint8Array | null = null;
    try {
      const response = await fetchImpl(signed.url, {
        method: "PUT",
        headers: Object.fromEntries(signed.headers),
        body: bytes,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
      });
      status = response.status;
      payload = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (status !== null) {
      if (status === 200) return;
      const code = /<Code>([^<]*)<\/Code>/.exec(new TextDecoder().decode(payload!))?.[1] ?? null;
      if (!RETRYABLE_S3_CODES.has(code ?? "") && status < 500) {
        throw new Error(`PUT s3://${bucket}/${key} failed with ${code ?? status}`);
      }
      lastError = new Error(`PUT s3://${bucket}/${key} failed with ${code ?? status}`);
    }
    if (attempt < 2) {
      await sleep(0.25 * 2 ** attempt * (0.75 + random() * 0.5) * 1000);
    }
  }
  throw lastError!;
}
