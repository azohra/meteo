import {
  parseSmokeDocumentJson,
  parseSiteForecastJson,
  type SmokeDocument,
  type SiteForecast,
} from "../contract.js";
import {
  documentPaths,
  trimTrailingSlash,
  TransportHttpError,
  type DocumentMiss,
} from "../transport.js";
import { parseHistoryIndexJson, splitHistoryArchive, type HistoryIndex } from "./archive.js";

export {
  parseHistoryIndexJson,
  splitHistoryArchive,
  type HistoryArchiveMember,
  type HistoryIndex,
} from "./archive.js";

/** The run stamp every archived forecast document carries; observation history lines deliberately do not satisfy it. */
export interface HistoryDocument {
  model: string;
  run: { referenceTime: string; generatedAt: string };
}

/** The subset of a WHATWG Response the history loader reads — bytes, not text. */
export interface HistoryResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The injected fetch; `init.headers` carries a `Range` header on the index fast path. */
export type HistoryFetch = (
  url: string,
  init?: { headers: Record<string, string> },
) => Promise<HistoryResponse>;

/** A republication, stated: the loader kept the run line with the latest `generatedAt` and these are the stamps it discarded (archive order). */
export interface HistoryRevision {
  referenceTime: string;
  keptGeneratedAt: string;
  supersededGeneratedAt: string[];
}

/** A line the contract guard rejected — never routine, log it loudly; the surviving lines still load. */
export interface HistoryInvalidLine {
  /** The archive the line came from. */
  url: string;
  /** Byte offset of the gzip member carrying the line. */
  memberByteOffset: number;
  /** 1-based line number within that member. */
  line: number;
}

/** A loaded history: runs deduped by (model, referenceTime) keep-latest-`generatedAt` and sorted ascending by `referenceTime`, plus everything the dedupe and guards reported. */
export interface LoadedHistory<T extends HistoryDocument> {
  runs: T[];
  /** Republications the dedupe discarded, ascending by referenceTime; empty when clean. */
  revisions: HistoryRevision[];
  /** Guard-rejected lines — contract breaks to log loudly; empty when clean. */
  invalidLines: HistoryInvalidLine[];
  /** Per requested month ("YYYY-MM") with nothing to contribute: `"absent"` is routine, `"invalid"` (the bytes failed to split) never is. */
  misses: Record<string, DocumentMiss>;
}

/** The shared options of the history loaders: where, which months, and how to narrow. */
export interface LoadSiteHistoryOptions {
  fetch: HistoryFetch;
  /** The data-tree root, as for transport/'s loaders. Trailing slash tolerated. */
  baseUrl: string;
  modelSlug: string;
  siteSlug: string;
  /** The months to read, as "YYYY-MM" keys. Order does not matter. */
  months: readonly string[];
  /** Inclusive `referenceTime` lower bound; with a usable sidecar index it enables the Range fast path, and any index failure degrades to the full fetch. */
  since?: string;
}

export interface LoadHistoryOptions<T extends HistoryDocument> extends LoadSiteHistoryOptions {
  /** The contract guard typing each history line — a history line is exactly the published document. */
  guard: (text: string) => T | null;
}

/**
 * Loads one site's month archives for a model — fetch (Range-narrowed when
 * possible), split members and lines, guard every line, dedupe — returning a
 * `LoadedHistory`, or an `"absent"` miss when every requested month is
 * absent; non-404 archive failures throw `TransportHttpError`, the only throw.
 */
export async function loadHistory<T extends HistoryDocument>(
  options: LoadHistoryOptions<T>,
): Promise<LoadedHistory<T> | DocumentMiss> {
  const { fetch, modelSlug, siteSlug, guard, since } = options;
  const base = trimTrailingSlash(options.baseUrl);
  const months = [...options.months].sort();
  const archiveUrl = (month: string) =>
    `${base}/${documentPaths.history(modelSlug, siteSlug, month)}`;
  const indexUrl = (month: string) =>
    `${base}/${documentPaths.historyIndex(modelSlug, siteSlug, month)}`;

  const misses: Record<string, DocumentMiss> = {};
  const invalidLines: HistoryInvalidLine[] = [];
  const lines: T[] = [];

  for (const month of months) {
    const url = archiveUrl(month);
    const fetched = await fetchArchive(fetch, url, since ? indexUrl(month) : undefined, since);
    if (fetched === "nothing-new") continue;
    if ("miss" in fetched) {
      misses[month] = fetched;
      continue;
    }
    const members = splitHistoryArchive(fetched.bytes);
    if (members === null) {
      misses[month] = { miss: "invalid", url };
      continue;
    }
    for (const member of members) {
      member.lines.forEach((text, lineIndex) => {
        const document = guard(text);
        if (document === null) {
          invalidLines.push({
            url,
            memberByteOffset: fetched.baseOffset + member.byteOffset,
            line: lineIndex + 1,
          });
          return;
        }
        if (since !== undefined && document.run.referenceTime < since) return;
        lines.push(document);
      });
    }
  }

  if (months.length > 0 && Object.keys(misses).length === months.length) {
    const allAbsent = Object.values(misses).every((miss) => miss.miss === "absent");
    if (allAbsent) return { miss: "absent", url: archiveUrl(months[months.length - 1]) };
  }

  const { runs, revisions } = dedupeKeepLatest(lines);
  return { runs, revisions, invalidLines, misses };
}

export type LoadForecastHistoryOptions = LoadSiteHistoryOptions;

/** The profile-typed `loadHistory`: a profile model's history lines are profile documents. */
export async function loadForecastHistory(
  options: LoadForecastHistoryOptions,
): Promise<LoadedHistory<SiteForecast> | DocumentMiss> {
  return loadHistory({ ...options, guard: parseSiteForecastJson });
}

export type LoadSmokeHistoryOptions = LoadSiteHistoryOptions;

/** The smoke-typed `loadHistory`: a smoke model's history lines are smoke documents. */
export async function loadSmokeHistory(
  options: LoadSmokeHistoryOptions,
): Promise<LoadedHistory<SmokeDocument> | DocumentMiss> {
  return loadHistory({ ...options, guard: parseSmokeDocumentJson });
}

interface FetchedArchive {
  bytes: Uint8Array;
  /** Archive offset of bytes[0] — 0 on a full fetch, the Range start on a 206. */
  baseOffset: number;
}

async function fetchArchive(
  fetch: HistoryFetch,
  archiveUrl: string,
  indexUrl: string | undefined,
  since: string | undefined,
): Promise<FetchedArchive | DocumentMiss | "nothing-new"> {
  let rangeStart = 0;
  if (indexUrl !== undefined && since !== undefined) {
    const index = await fetchIndex(fetch, indexUrl);
    if (index !== null && index.members.length > 0) {
      // Only a member the index PROVES too old is skippable; a member with
      // no run stamp (a multi-line append, an observation batch) could hold
      // needed lines, so it stays in the fetch and the line guards judge it.
      const needed = index.members.filter(
        (member) => member.referenceTime === undefined || member.referenceTime >= since,
      );
      const uncoveredTailOffset = Math.max(
        ...index.members.map((member) => member.byteOffset + member.byteLength),
      );
      rangeStart =
        needed.length > 0
          ? Math.min(...needed.map((member) => member.byteOffset))
          : uncoveredTailOffset;
    }
  }

  if (rangeStart > 0) {
    const response = await fetch(archiveUrl, {
      headers: { Range: `bytes=${rangeStart}-` },
    });
    if (response.status === 404) return { miss: "absent", url: archiveUrl };
    if (response.status === 416) return "nothing-new";
    if (!response.ok) throw new TransportHttpError(response.status, archiveUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, baseOffset: response.status === 206 ? rangeStart : 0 };
  }

  const response = await fetch(archiveUrl);
  if (response.status === 404) return { miss: "absent", url: archiveUrl };
  if (!response.ok) throw new TransportHttpError(response.status, archiveUrl);
  return { bytes: new Uint8Array(await response.arrayBuffer()), baseOffset: 0 };
}

async function fetchIndex(fetch: HistoryFetch, url: string): Promise<HistoryIndex | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return parseHistoryIndexJson(new TextDecoder().decode(await response.arrayBuffer()));
  } catch {
    return null;
  }
}

function dedupeKeepLatest<T extends HistoryDocument>(
  lines: readonly T[],
): { runs: T[]; revisions: HistoryRevision[] } {
  const byRun = new Map<string, { kept: T; all: T[] }>();
  for (const line of lines) {
    const key = `${line.model}\u0000${line.run.referenceTime}`;
    const entry = byRun.get(key);
    if (entry === undefined) {
      byRun.set(key, { kept: line, all: [line] });
      continue;
    }
    entry.all.push(line);
    if (line.run.generatedAt >= entry.kept.run.generatedAt) entry.kept = line;
  }

  const runs = [...byRun.values()]
    .map((entry) => entry.kept)
    .sort((a, b) => a.run.referenceTime.localeCompare(b.run.referenceTime));
  const revisions = [...byRun.values()]
    .filter((entry) => entry.all.length > 1)
    .map((entry) => ({
      referenceTime: entry.kept.run.referenceTime,
      keptGeneratedAt: entry.kept.run.generatedAt,
      supersededGeneratedAt: entry.all
        .filter((line) => line !== entry.kept)
        .map((line) => line.run.generatedAt),
    }))
    .sort((a, b) => a.referenceTime.localeCompare(b.referenceTime));
  return { runs, revisions };
}

export {
  compareRunAnalyses,
  compareRuns,
  DEFAULT_LEAD_ANCHOR_LOCAL_HOUR,
  DEFAULT_SETTLED_THRESHOLDS,
  RUN_COMPARISON_VOCABULARY_VERSION,
  type CompareRunAnalysesOptions,
  type CompareRunsOptions,
  type CompareRunsSharedOptions,
  type ExistenceRung,
  type ExistenceTrajectoryFinding,
  type IdentityDriftFinding,
  type MagnitudeRung,
  type MagnitudeTrajectoryFinding,
  type RunComparison,
  type RunComparisonFinding,
  type RunComparisonFindingKind,
  type RunTimingVote,
  type SettledFinding,
  type TimingTrajectoryFinding,
} from "./compare-runs.js";

export { INDEX_SCHEMA_VERSION, type MonthIndex, type MonthIndexMember } from "./archive.js";

export {
  appendHistory,
  appendHistoryLines,
  ARCHIVE_SUFFIX,
  compactJson,
  INDEX_SUFFIX,
  indexPath,
  monthIndex,
  seededMonthArchive,
  splitMembers,
  writeJson,
  writeMonthIndex,
  type ArchivableProfile,
  type PublishedHistoryReader,
} from "./write.js";
