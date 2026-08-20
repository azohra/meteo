import { AwsClient } from "aws4fetch";
import { documentPaths } from "@azohra/meteo.briefing/transport";
import { PublisherConfigurationError } from "./config.js";
import type { PublishedManifest, PublishedManifestReader } from "./publish.js";
import {
  REQUEST_TIMEOUT_S,
  USER_AGENT,
  transportBackoff,
  type TransportFetch,
  type TransportResponse,
} from "./providers/transport.js";

export function dataBase(): string {
  const base = process.env["METEO_DATA_BASE"];
  if (!base) {
    throw new PublisherConfigurationError(
      "no published data base is configured: set METEO_DATA_BASE to the " +
        "dataset's public URL, or provide the S3 credential set " +
        "(METEO_S3_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) " +
        "plus METEO_R2_BUCKET to read through the authenticated S3 API",
    );
  }
  return base.replace(/\/+$/, "");
}

/* The endpoint's vendor-neutral name; R2_ENDPOINT stays honored as an
   alias for deployments that configured it before the rename. */
function s3Endpoint(): string | undefined {
  return process.env["METEO_S3_ENDPOINT"] ?? process.env["R2_ENDPOINT"];
}

export function s3Mode(): boolean {
  return (
    !process.env["METEO_DATA_BASE"] &&
    s3Endpoint() !== undefined &&
    ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"].every((name) => process.env[name])
  );
}

function s3Bucket(): string {
  const bucket = process.env["METEO_R2_BUCKET"];
  if (!bucket) {
    throw new PublisherConfigurationError(
      "dataset reads are in authenticated S3 mode (METEO_S3_ENDPOINT and " +
        "the AWS credentials are set) but no bucket is configured: set " +
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

/* Shared by the read path here and the publisher's PUTs: keep the S3
   client (retryable codes, signing, key encoding, backoff) in this
   module only. */
export const RETRYABLE_S3_CODES = new Set([
  "InternalError",
  "RequestTimeout",
  "ServiceUnavailable",
  "SlowDown",
  "Throttling",
  "ThrottlingException",
]);

const S3_SIGV4_REGION = "auto";

export function s3ErrorCode(payload: Uint8Array): string | null {
  return /<Code>([^<]*)<\/Code>/.exec(new TextDecoder().decode(payload))?.[1] ?? null;
}

export interface SignedS3Init {
  method: "GET" | "PUT";
  headers?: Record<string, string>;
  body?: Uint8Array<ArrayBuffer>;
}

/** One signed request against the dataset bucket; throws on transport failure. */
export async function signedS3Fetch(
  key: string,
  init: SignedS3Init,
  options: DatasetOptions,
): Promise<{ status: number; payload: Uint8Array }> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const endpoint = (s3Endpoint() ?? "").replace(/\/+$/, "");
  const bucket = s3Bucket();
  const client = new AwsClient({
    accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "",
    service: "s3",
    region: S3_SIGV4_REGION,
  });
  const url = `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const signed = await client.sign(url, init);
  const response = await fetchImpl(signed.url, {
    method: init.method,
    headers: Object.fromEntries(signed.headers),
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
  });
  return { status: response.status, payload: new Uint8Array(await response.arrayBuffer()) };
}

/** `s3://bucket/key` for error messages. */
export function s3ObjectName(key: string): string {
  return `s3://${s3Bucket()}/${key}`;
}

async function fetchPublishedS3(key: string, options: DatasetOptions): Promise<Uint8Array | null> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let exchange: { status: number; payload: Uint8Array } | null = null;
    try {
      exchange = await signedS3Fetch(key, { method: "GET" }, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (exchange !== null) {
      if (exchange.status === 200) {
        return exchange.payload;
      }
      const code = s3ErrorCode(exchange.payload);
      if (code === "NoSuchKey") {
        return null;
      }
      if (code === "AccessDenied") {
        throw new Error(
          `${s3ObjectName(key)} answered AccessDenied: this process holds ` +
            "credentials, so denial is a misconfigured token or bucket " +
            "policy — never absence. Fix the token's read permission, or " +
            "unset METEO_S3_ENDPOINT / R2_ENDPOINT / AWS_ACCESS_KEY_ID / " +
            "AWS_SECRET_ACCESS_KEY to read the public base.",
        );
      }
      if (!RETRYABLE_S3_CODES.has(code ?? "") && exchange.status < 500) {
        throw new Error(`${s3ObjectName(key)} failed with ${code ?? exchange.status}`);
      }
      lastError = new Error(`${s3ObjectName(key)} failed with ${code ?? exchange.status}`);
    }
    if (attempt < 2) {
      await transportBackoff(attempt, options);
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
      await transportBackoff(attempt, options);
    }
  }
  throw lastError!;
}

export async function publishedManifest(
  modelSlug: string,
  options: DatasetOptions = {},
): Promise<PublishedManifest | null> {
  const payload = await fetchPublished(documentPaths.manifest(modelSlug), options);
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
  const payload = await fetchPublished(documentPaths.history(modelSlug, siteId, month), options);
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
