import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  INDEX_SCHEMA_VERSION,
  splitHistoryArchive,
  type HistoryArchiveMember,
  type MonthIndex,
  type MonthIndexMember,
} from "./archive.js";

export const ARCHIVE_SUFFIX = ".jsonl.gz";
export const INDEX_SUFFIX = ".index.json";

/**
 * Splits archive bytes into independent gzip members with exact byte
 * boundaries — the shared reader walk, rethrown loudly: the archives are
 * the publishing pipeline's own writes, so damage is a bug, not weather.
 */
export function splitMembers(data: Uint8Array): HistoryArchiveMember[] {
  const members = splitHistoryArchive(data);
  if (members === null) {
    throw new Error("truncated or corrupt gzip member sequence in month archive");
  }
  return members;
}

/**
 * The sidecar index document for one month archive: a pure function of
 * the archive bytes, so recomputing after every append needs no
 * incremental bookkeeping.
 */
export function monthIndex(archiveBytes: Uint8Array, archiveName: string): MonthIndex {
  const members = splitMembers(archiveBytes);
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    archive: archiveName,
    archiveLength: archiveBytes.length,
    members: members.map((member) => memberEntry(member)),
  };
}

function memberEntry(member: HistoryArchiveMember): MonthIndexMember {
  const entry: MonthIndexMember = {
    byteOffset: member.byteOffset,
    byteLength: member.byteLength,
    lines: member.lines.length,
  };
  const first = (member.lines.length > 0 ? JSON.parse(member.lines[0]) : {}) as Record<
    string,
    unknown
  >;
  const run = first["run"];
  if (
    member.lines.length === 1 &&
    typeof run === "object" &&
    run !== null &&
    !Array.isArray(run) &&
    "referenceTime" in run
  ) {
    entry.referenceTime = (run as Record<string, string>)["referenceTime"];
    entry.generatedAt = (run as Record<string, string | undefined>)["generatedAt"] ?? null;
  } else if ("observedAt" in first) {
    entry.firstObservedAt = first["observedAt"] as string;
    entry.lastObservedAt = (
      JSON.parse(member.lines[member.lines.length - 1]) as Record<string, string>
    )["observedAt"];
  }
  return entry;
}

export function indexPath(archivePath: string): string {
  return archivePath.endsWith(ARCHIVE_SUFFIX)
    ? archivePath.slice(0, -ARCHIVE_SUFFIX.length) + INDEX_SUFFIX
    : archivePath + INDEX_SUFFIX;
}

/** (Re)writes the sidecar index beside its archive from the archive's current bytes, as plain JSON. */
export function writeMonthIndex(archivePath: string): string {
  const document = monthIndex(readFileSync(archivePath), archiveName(archivePath));
  const path = indexPath(archivePath);
  writeFileSync(path, JSON.stringify(document, null, 2) + "\n");
  return path;
}

/** Reads one site-month's already-published archive bytes, empty when the month has no archive yet. */
export type PublishedHistoryReader = (model: string, siteId: string, month: string) => Uint8Array;

/** The profile shape the append flow reads — the whole document archives. */
export interface ArchivableProfile {
  model: string;
  run: { referenceTime: string; [key: string]: unknown };
  site: { id: string; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Archives the profile under <historyDir>/<slug>/<YYYY-MM>.jsonl.gz (the
 * month taken from the run's referenceTime), appending one independent
 * gzip member per run — existing bytes are never rewritten — and
 * rewriting the month's sidecar index.
 */
export function appendHistory(
  profile: ArchivableProfile,
  historyDir: string,
  publishedHistory: PublishedHistoryReader,
): void {
  const archivePath = seededMonthArchive(
    profile.model,
    profile.site.id,
    profile.run.referenceTime.slice(0, 7),
    historyDir,
    publishedHistory,
  );
  const line = compactJson(profile) + "\n";
  appendFileSync(archivePath, gzipSync(Buffer.from(line)));
  writeMonthIndex(archivePath);
}

/**
 * Archives arbitrary JSON lines under <historyDir>/<site>/<month>.jsonl.gz
 * — the same first-touch seeding and independent-gzip-member append as
 * appendHistory, but the caller chooses the line grammar and the month.
 */
export function appendHistoryLines(
  model: string,
  siteId: string,
  month: string,
  lines: readonly unknown[],
  historyDir: string,
  publishedHistory: PublishedHistoryReader,
): void {
  if (lines.length === 0) {
    return;
  }
  const archivePath = seededMonthArchive(model, siteId, month, historyDir, publishedHistory);
  const payload = lines.map((line) => compactJson(line) + "\n").join("");
  appendFileSync(archivePath, gzipSync(Buffer.from(payload)));
  writeMonthIndex(archivePath);
}

/**
 * The site's month archive path, seeded from the published month's bytes
 * on its first touch in this build — the seeding is what makes an append
 * unable to rewrite published bytes; an unpublished month seeds empty.
 */
export function seededMonthArchive(
  model: string,
  siteId: string,
  month: string,
  historyDir: string,
  publishedHistory: PublishedHistoryReader,
): string {
  const directory = join(historyDir, siteId);
  mkdirSync(directory, { recursive: true });
  const archivePath = join(directory, `${month}${ARCHIVE_SUFFIX}`);
  if (!existsSync(archivePath)) {
    writeFileSync(archivePath, publishedHistory(model, siteId, month));
  }
  return archivePath;
}

function archiveName(archivePath: string): string {
  return basename(archivePath);
}

/**
 * One published document as one compact ASCII JSON line: non-finite
 * numbers throw naming the offending key path (JSON.stringify would
 * silently emit null), and non-ASCII characters are escaped so published
 * bytes never change format.
 */
export function compactJson(value: unknown): string {
  assertPublishable(value, "$");
  return toAsciiJson(JSON.stringify(value));
}

/** Writes one publishable JSON document, compact or 2-space indented, with the same non-finite guard and ASCII escaping as compactJson. */
export function writeJson(path: string, value: unknown, { compact }: { compact: boolean }): void {
  assertPublishable(value, "$");
  const text = compact
    ? toAsciiJson(JSON.stringify(value))
    : toAsciiJson(JSON.stringify(value, null, 2));
  writeFileSync(path, text + "\n");
}

function assertPublishable(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite value ${value} at ${path} — refusing to publish`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublishable(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertPublishable(item, `${path}.${key}`);
    }
  }
}

function toAsciiJson(text: string): string {
  return text.replace(
    /[\u0080-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
