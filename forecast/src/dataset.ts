import { AwsClient } from "aws4fetch";
import { PublisherConfigurationError } from "./config.js";
import type { PublishedManifest, PublishedManifestReader } from "./publish.js";
import {
  REQUEST_TIMEOUT_S,
  USER_AGENT,
  type TransportFetch,
  type TransportResponse,
} from "./providers/transport.js";

export function dataBase(): string {
  const base = process.env["METEO_DATA_BASE"];
  if (!base) {
    throw new PublisherConfigurationError(
      "no published data base is configured: set METEO_DATA_BASE to the " +
        "dataset's public URL, or provide the R2 credential set " +
        "(R2_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) plus " +
        "METEO_R2_BUCKET to read through the authenticated S3 API",
    );
  }
  return base.replace(/\/+$/, "");
}

export function s3Mode(): boolean {
  return (
    !process.env["METEO_DATA_BASE"] &&
    ["R2_ENDPOINT", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"].every((name) => process.env[name])
  );
}

function s3Bucket(): string {
  const bucket = process.env["METEO_R2_BUCKET"];
  if (!bucket) {
    throw new PublisherConfigurationError(
      "dataset reads are in authenticated S3 mode (R2_ENDPOINT and the " +
        "AWS credentials are set) but no bucket is configured: set " +
        "METEO_R2_BUCKET to the dataset bucket's name, or set " +
        "METEO_DATA_BASE to read a published tree over public HTTPS",
    );
  }
  return bucket;
}

export interface DatasetOptions {
  fetch?: TransportFetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const RETRYABLE_S3_CODES = new Set([
  "InternalError",
  "RequestTimeout",
  "ServiceUnavailable",
  "SlowDown",
  "Throttling",
  "ThrottlingException",
]);

const R2_SIGV4_REGION = "auto";

async function fetchPublishedS3(key: string, options: DatasetOptions): Promise<Uint8Array | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const endpoint = (process.env["R2_ENDPOINT"] ?? "").replace(/\/+$/, "");
  const bucket = s3Bucket();
  const client = new AwsClient({
    accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "",
    service: "s3",
    region: R2_SIGV4_REGION,
  });
  const url = `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const signed = await client.sign(url, { method: "GET" });
    let response: TransportResponse | null = null;
    let payload: Uint8Array | null = null;
    try {
      response = await fetchImpl(signed.url, {
        method: "GET",
        headers: Object.fromEntries(signed.headers),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
      });
      payload = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      response = null;
    }
    if (response !== null) {
      if (response.status === 200) {
        return payload!;
      }
      const code = /<Code>([^<]*)<\/Code>/.exec(new TextDecoder().decode(payload!))?.[1] ?? null;
      if (code === "NoSuchKey") {
        return null;
      }
      if (code === "AccessDenied") {
        throw new Error(
          `s3://${bucket}/${key} on ${endpoint} answered AccessDenied: this ` +
            "process holds credentials, so denial is a misconfigured token " +
            "or bucket policy — never absence. Fix the R2 token's read " +
            "permission, or unset R2_ENDPOINT / AWS_ACCESS_KEY_ID / " +
            "AWS_SECRET_ACCESS_KEY to read the public base.",
        );
      }
      if (!RETRYABLE_S3_CODES.has(code ?? "") && response.status < 500) {
        throw new Error(`s3://${bucket}/${key} failed with ${code ?? response.status}`);
      }
      lastError = new Error(`s3://${bucket}/${key} failed with ${code ?? response.status}`);
    }
    if (attempt < 2) {
      await sleep(0.25 * 2 ** attempt * (0.75 + random() * 0.5) * 1000);
    }
  }
  throw lastError!;
}

export async function fetchPublished(
  path: string,
  options: DatasetOptions = {},
): Promise<Uint8Array | null> {
  const key = path.replace(/^\/+/, "");
  if (s3Mode()) {
    return fetchPublishedS3(key, options);
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const url = `${dataBase()}/${key}`;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: TransportResponse | null = null;
    let payload: Uint8Array | null = null;
    try {
      response = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
      });
      if (response.status === 200) {
        payload = new Uint8Array(await response.arrayBuffer());
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      response = null;
    }
    if (response !== null) {
      if (response.status === 200) {
        return payload!;
      }
      if (response.status === 403 || response.status === 404) {
        if (response.headers.get("cf-mitigated") === "challenge") {
          throw new Error(
            `data base ${url} answered a Cloudflare bot challenge ` +
              "(cf-mitigated: challenge): automated reads from this " +
              "network are blocked. Fix the zone's WAF/bot rules for the " +
              "data hostname; treating a challenge as 'not yet published' " +
              "would silently reset incremental state.",
          );
        }
        return null;
      }
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`data base ${url} failed with ${response.status}`);
      }
      lastError = new Error(`data base ${url} failed with ${response.status}`);
    }
    if (attempt < 2) {
      await sleep(0.25 * 2 ** attempt * (0.75 + random() * 0.5) * 1000);
    }
  }
  throw lastError!;
}

export async function publishedManifest(
  modelSlug: string,
  options: DatasetOptions = {},
): Promise<PublishedManifest | null> {
  const payload = await fetchPublished(`${modelSlug}/manifest.json`, options);
  return payload === null
    ? null
    : (JSON.parse(new TextDecoder().decode(payload)) as PublishedManifest);
}

export async function publishedReferenceTime(
  modelSlug: string,
  options: DatasetOptions = {},
): Promise<string | null> {
  const manifest = await publishedManifest(modelSlug, options);
  return manifest === null ? null : (manifest.referenceTime ?? null);
}

export async function publishedHistory(
  modelSlug: string,
  siteId: string,
  month: string,
  options: DatasetOptions = {},
): Promise<Uint8Array> {
  const payload = await fetchPublished(`${modelSlug}/history/${siteId}/${month}.jsonl.gz`, options);
  return payload ?? new Uint8Array(0);
}

export async function prefetchedManifestReader(
  modelSlugs: readonly string[],
  options: DatasetOptions = {},
): Promise<PublishedManifestReader> {
  const manifests = new Map<string, PublishedManifest | null>();
  await Promise.all(
    modelSlugs.map(async (slug) => {
      manifests.set(slug, await publishedManifest(slug, options));
    }),
  );
  return (slug) => manifests.get(slug) ?? null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
