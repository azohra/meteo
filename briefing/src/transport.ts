import {
  parseObservationDocumentJson,
  parseRunsIndexJson,
  parseSmokeDocumentJson,
  parseForecastManifestJson,
  parseSiteForecastJson,
  type ObservationDocument,
  type RunsIndex,
  type SmokeDocument,
  type ForecastManifest,
  type SiteForecast,
} from "./contract.js";

/** The subset of a WHATWG Response the transport reads. */
export interface TransportResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** The injected fetch: `(url) => Promise<Response-like>`; the global WHATWG `fetch` satisfies it directly. */
export type TransportFetch = (url: string) => Promise<TransportResponse>;

/** The subset of a WHATWG RequestInit the byte-oriented clients send. */
export interface TransportInit {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** The subset of a WHATWG Response the byte-oriented clients read. */
export interface BinaryTransportResponse {
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The injected byte-oriented fetch: `(url, init?) => Promise<Response-like>`; the global WHATWG `fetch` satisfies it directly. */
export type BinaryTransportFetch = (
  url: string,
  init?: TransportInit,
) => Promise<BinaryTransportResponse>;

/** A non-404 HTTP failure — the transport's only throw. */
export class TransportHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`${status} fetching ${url}`);
    this.name = "TransportHttpError";
  }
}

/**
 * Why a load had nothing to return: `"absent"` (HTTP 404 — routine) or
 * `"invalid"` (the document exists but failed the contract guard — never
 * routine, log it loudly). `url` names the offending document;
 * discriminate with `"miss" in result`.
 */
export interface DocumentMiss {
  miss: "absent" | "invalid";
  url: string;
  /**
   * For an invalid miss whose bytes are well-formed JSON carrying a numeric
   * `schemaVersion`: that declared number. Newer than the installed
   * contract's constant for the family means a newer writer published it —
   * upgrade the package rather than debugging bytes. Absent when the bytes
   * are not versioned JSON at all — that one is corruption.
   */
  declaredSchemaVersion?: number;
}

/**
 * The published tree's path layout — the one home for where every published
 * document lives, root-relative with no leading slash. The loaders here and
 * in `history/` build every URL as `${baseUrl}/${documentPaths...}`; the
 * same keys address the tree where there is no URL at all, e.g. as object
 * keys against a store binding (a Cloudflare R2 bucket) holding the
 * published dataset.
 */
export const documentPaths = {
  /** `<model>/manifest.json` — the model's per-build manifest. */
  manifest(modelSlug: string): string {
    return `${modelSlug}/manifest.json`;
  },
  /** `<model>/sites/<site>.json` — one site's current document (profile, smoke, or observation). */
  siteDocument(modelSlug: string, siteSlug: string): string {
    return `${modelSlug}/sites/${siteSlug}.json`;
  },
  /** `<model>/history/<site>/<YYYY-MM>.jsonl.gz` — one site's append-only month archive. */
  history(modelSlug: string, siteSlug: string, monthKey: string): string {
    return `${modelSlug}/history/${siteSlug}/${monthKey}.jsonl.gz`;
  },
  /** `<model>/history/<site>/<YYYY-MM>.index.json` — the month archive's advisory byte-offset sidecar index. */
  historyIndex(modelSlug: string, siteSlug: string, monthKey: string): string {
    return `${modelSlug}/history/${siteSlug}/${monthKey}.index.json`;
  },
  /** `models.json` — the hand-maintained model catalogue at the dataset root. */
  models(): string {
    return "models.json";
  },
  /** `sites.json` — the hand-maintained site catalogue at the dataset root. */
  sites(): string {
    return "sites.json";
  },
  /** `site-context.json` — the measured per-site ground truth at the dataset root. */
  siteContext(): string {
    return "site-context.json";
  },
  /** `runs.json` — the machine-written cross-model run index at the dataset root. */
  runs(): string {
    return "runs.json";
  },
};

/** The run-identity stamp shared by every forecast document kind; observation documents deliberately do not satisfy it. */
export interface RunStampedDocument {
  model: string;
  run: { referenceTime: string };
}

/** True when the manifest and document describe the same model and run; a pair failing this is a torn read that must not render as one forecast. */
export function runsConsistent(manifest: ForecastManifest, document: RunStampedDocument): boolean {
  return manifest.model === document.model && manifest.referenceTime === document.run.referenceTime;
}

export interface RetryOptions {
  /** Delay before the single retry, ms. Default 1500. */
  delayMs?: number;
  /** Sleep implementation — injectable so tests never actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** The shared options of every per-site loader: where, which, and how to retry. */
export interface LoadSiteDocumentOptions {
  fetch: TransportFetch;
  /** The data-tree root, e.g. "https://meteo.azohra.com/data-sample". Trailing slash tolerated. */
  baseUrl: string;
  modelSlug: string;
  siteSlug: string;
  retry?: RetryOptions;
}

export interface LoadDocumentOptions<T extends RunStampedDocument> extends LoadSiteDocumentOptions {
  /** The contract guard for the site document; the manifest side of the pair is always guarded by the forecast-manifest guard. */
  guard: (text: string) => T | null;
}

export interface LoadedDocument<T extends RunStampedDocument> {
  manifest: ForecastManifest;
  document: T;
  /** True when the pair still disagreed about the run after the retry — a publish is in flight; never mix the two documents as one forecast. */
  stale: boolean;
}

/**
 * Fetches a model's manifest and one site's run-stamped document as a
 * consistent pair, retrying the pair once on run disagreement; returns
 * the pair (with `stale: true` when still torn) or a discriminated
 * `DocumentMiss`, and throws `TransportHttpError` on non-404 failures.
 */
export async function loadDocument<T extends RunStampedDocument>(
  options: LoadDocumentOptions<T>,
): Promise<LoadedDocument<T> | DocumentMiss> {
  const { fetch, modelSlug, siteSlug, guard } = options;
  const base = trimTrailingSlash(options.baseUrl);
  const manifestUrl = `${base}/${documentPaths.manifest(modelSlug)}`;
  const documentUrl = `${base}/${documentPaths.siteDocument(modelSlug, siteSlug)}`;
  const delayMs = options.retry?.delayMs ?? 1500;
  const sleep = options.retry?.sleep ?? defaultSleep;

  const fetchPair = async () => {
    const [manifest, document] = await Promise.all([
      fetchDocument(fetch, manifestUrl, parseForecastManifestJson),
      fetchDocument(fetch, documentUrl, guard),
    ]);
    return { manifest, document };
  };

  const first = await fetchPair();
  if (isMiss(first.manifest)) return first.manifest;
  if (isMiss(first.document)) return first.document;
  if (runsConsistent(first.manifest, first.document)) {
    return { manifest: first.manifest, document: first.document, stale: false };
  }

  await sleep(delayMs);
  const second = await fetchPair();
  if (!isMiss(second.manifest) && !isMiss(second.document)) {
    return {
      manifest: second.manifest,
      document: second.document,
      stale: !runsConsistent(second.manifest, second.document),
    };
  }
  return { manifest: first.manifest, document: first.document, stale: true };
}

export type LoadForecastOptions = LoadSiteDocumentOptions;

export interface LoadedForecast {
  manifest: ForecastManifest;
  profile: SiteForecast;
  /** See `LoadedDocument.stale`: still torn after the retry — a publish is in flight. */
  stale: boolean;
}

/** The profile-typed `loadDocument`, with exactly the generic loader's semantics. */
export async function loadForecast(
  options: LoadForecastOptions,
): Promise<LoadedForecast | DocumentMiss> {
  const loaded = await loadDocument({ ...options, guard: parseSiteForecastJson });
  if (isMiss(loaded)) return loaded;
  return { manifest: loaded.manifest, profile: loaded.document, stale: loaded.stale };
}

export type LoadSmokeOptions = LoadSiteDocumentOptions;

export interface LoadedSmoke {
  manifest: ForecastManifest;
  smoke: SmokeDocument;
  /** See `LoadedDocument.stale`: still torn after the retry — a publish is in flight. */
  stale: boolean;
}

/** The smoke-typed `loadDocument`: smoke documents carry the same run stamp as profiles, so they run the identical skew dance. */
export async function loadSmoke(options: LoadSmokeOptions): Promise<LoadedSmoke | DocumentMiss> {
  const loaded = await loadDocument({ ...options, guard: parseSmokeDocumentJson });
  if (isMiss(loaded)) return loaded;
  return { manifest: loaded.manifest, smoke: loaded.document, stale: loaded.stale };
}

/** `loadObservation`'s options: no `retry`, because there is no dance to retry. */
export interface LoadObservationOptions {
  fetch: TransportFetch;
  /** The data-tree root, as for `loadDocument`. */
  baseUrl: string;
  modelSlug: string;
  siteSlug: string;
}

/**
 * Fetches one site's observation document — a guarded single fetch, no
 * manifest and no skew dance: an observation document has no run, so
 * there is no pair invariant to defend. Misses discriminate exactly like
 * `loadDocument`'s; non-404 HTTP errors throw `TransportHttpError`.
 */
export async function loadObservation(
  options: LoadObservationOptions,
): Promise<ObservationDocument | DocumentMiss> {
  const base = trimTrailingSlash(options.baseUrl);
  const documentUrl = `${base}/${documentPaths.siteDocument(options.modelSlug, options.siteSlug)}`;
  return fetchDocument(options.fetch, documentUrl, parseObservationDocumentJson);
}

export interface LoadSiteSetOptions<T extends RunStampedDocument> {
  fetch: TransportFetch;
  /** The data-tree root, as for `loadDocument`. */
  baseUrl: string;
  modelSlug: string;
  /** The sites to load — typically every catalogued site the caller serves. */
  siteSlugs: readonly string[];
  /** The contract guard for the site documents, exactly as in `loadDocument`. */
  guard: (text: string) => T | null;
  retry?: RetryOptions;
}

/**
 * `loadSiteSet`'s discriminated result: `syncing: false` is a coherent
 * publication (every returned document carries the manifest's run, with
 * per-site misses discriminated); `syncing: true` means the set still
 * mixed runs after the retry — ingest nothing, the next poll reads
 * coherently.
 */
export type LoadedSiteSet<T extends RunStampedDocument> =
  | {
      syncing: false;
      /** The anchoring manifest's run — every document below carries it. */
      referenceTime: string;
      manifest: ForecastManifest;
      documents: Record<string, T>;
      misses: Record<string, DocumentMiss>;
    }
  | { syncing: true; runsSeen: string[] };

/**
 * Fetches one model's documents for a set of sites as one coherent
 * publication, manifest-anchored: the manifest is fetched once as the
 * commit point and every document must carry its run. On mid-publish
 * incoherence it retries once, refetching the manifest and only the
 * disagreeing documents; a manifest miss returns that `DocumentMiss`,
 * per-site misses never poison the set, and `TransportHttpError` is the
 * only throw.
 */
export async function loadSiteSet<T extends RunStampedDocument>(
  options: LoadSiteSetOptions<T>,
): Promise<LoadedSiteSet<T> | DocumentMiss> {
  const { fetch, modelSlug, siteSlugs, guard } = options;
  const base = trimTrailingSlash(options.baseUrl);
  const manifestUrl = `${base}/${documentPaths.manifest(modelSlug)}`;
  const documentUrl = (siteSlug: string) =>
    `${base}/${documentPaths.siteDocument(modelSlug, siteSlug)}`;
  const delayMs = options.retry?.delayMs ?? 1500;
  const sleep = options.retry?.sleep ?? defaultSleep;

  let manifest = await fetchDocument(fetch, manifestUrl, parseForecastManifestJson);
  if (isMiss(manifest)) return manifest;

  const documents: Record<string, T> = {};
  const misses: Record<string, DocumentMiss> = {};
  await Promise.all(
    siteSlugs.map(async (siteSlug) => {
      const loaded = await fetchDocument(fetch, documentUrl(siteSlug), guard);
      if (isMiss(loaded)) misses[siteSlug] = loaded;
      else documents[siteSlug] = loaded;
    }),
  );

  const anchor = manifest;
  let disagreeing = Object.keys(documents).filter(
    (siteSlug) => !runsConsistent(anchor, documents[siteSlug]),
  );
  if (disagreeing.length > 0) {
    await sleep(delayMs);
    const [retriedManifest] = await Promise.all([
      fetchDocument(fetch, manifestUrl, parseForecastManifestJson),
      ...disagreeing.map(async (siteSlug) => {
        const retried = await fetchDocument(fetch, documentUrl(siteSlug), guard);
        if (!isMiss(retried)) documents[siteSlug] = retried;
      }),
    ]);
    if (!isMiss(retriedManifest)) manifest = retriedManifest;
    const reAnchor = manifest;
    disagreeing = Object.keys(documents).filter(
      (siteSlug) => !runsConsistent(reAnchor, documents[siteSlug]),
    );
  }

  if (disagreeing.length > 0) {
    const runsSeen = [
      ...new Set([
        manifest.referenceTime,
        ...Object.values(documents).map((document) => document.run.referenceTime),
      ]),
    ].sort();
    return { syncing: true, runsSeen };
  }
  return { syncing: false, referenceTime: manifest.referenceTime, manifest, documents, misses };
}

export interface LoadRunsOptions {
  fetch: TransportFetch;
  /** The data-tree root, as for `loadForecast`. */
  baseUrl: string;
}

/** Fetches data/runs.json — the cross-model run index — with the same miss semantics as `loadForecast`. */
export async function loadRuns(options: LoadRunsOptions): Promise<RunsIndex | DocumentMiss> {
  const base = trimTrailingSlash(options.baseUrl);
  return fetchDocument(options.fetch, `${base}/${documentPaths.runs()}`, parseRunsIndexJson);
}

function isMiss<T extends object>(value: T | DocumentMiss): value is DocumentMiss {
  return "miss" in value;
}

async function fetchDocument<T extends object>(
  fetch: TransportFetch,
  url: string,
  guard: (text: string) => T | null,
): Promise<T | DocumentMiss> {
  const response = await fetch(url);
  if (response.status === 404) return { miss: "absent", url };
  if (!response.ok) throw new TransportHttpError(response.status, url);
  const text = await response.text();
  const parsed = guard(text);
  if (parsed !== null) return parsed;
  const declared = declaredSchemaVersion(text);
  return declared === undefined
    ? { miss: "invalid", url }
    : { miss: "invalid", url, declaredSchemaVersion: declared };
}

/* An invalid document that is still well-formed JSON with a numeric
   schemaVersion is almost always a version story, not corruption — echo the
   number so the reader can say "upgrade" instead of only "invalid". */
function declaredSchemaVersion(text: string): number | undefined {
  try {
    const document: unknown = JSON.parse(text);
    if (typeof document !== "object" || document === null || Array.isArray(document)) {
      return undefined;
    }
    const version = (document as { schemaVersion?: unknown }).schemaVersion;
    return typeof version === "number" ? version : undefined;
  } catch {
    return undefined;
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
