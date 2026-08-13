import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync, inflateRawSync } from "node:zlib";

export const INDEX_SCHEMA_VERSION = 1;

export const ARCHIVE_SUFFIX = ".jsonl.gz";
export const INDEX_SUFFIX = ".index.json";

/** One independent gzip member: where it sits and what it says. */
export interface Member {
  offset: number;
  length: number;
  /** Decompressed JSON lines, newline stripped. */
  lines: string[];
}

/** One member's sidecar index entry. */
export interface MonthIndexMember {
  byteOffset: number;
  byteLength: number;
  lines: number;
  referenceTime?: string;
  generatedAt?: string | null;
  firstObservedAt?: string;
  lastObservedAt?: string;
}

/** The sidecar index document for one month archive. */
export interface MonthIndex {
  schemaVersion: number;
  archive: string;
  archiveLength: number;
  members: MonthIndexMember[];
}

const GZIP_ID1 = 0x1f;
const GZIP_ID2 = 0x8b;
const GZIP_DEFLATE_METHOD = 8;
const GZIP_HEADER_LENGTH = 10;
const GZIP_FHCRC = 0x02;
const GZIP_FEXTRA = 0x04;
const GZIP_FNAME = 0x08;
const GZIP_FCOMMENT = 0x10;

/**
 * Splits archive bytes into independent gzip members with exact byte
 * boundaries. A truncated or corrupt member fails loudly — the archives
 * are the publishing pipeline's own writes, so damage is a bug.
 */
export function splitMembers(data: Uint8Array): Member[] {
  const members: Member[] = [];
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset < data.length) {
    const start = offset;
    const truncated = () => new Error(`truncated gzip member at byte ${start}`);
    if (offset + GZIP_HEADER_LENGTH > data.length) throw truncated();
    if (
      data[offset] !== GZIP_ID1 ||
      data[offset + 1] !== GZIP_ID2 ||
      data[offset + 2] !== GZIP_DEFLATE_METHOD
    ) {
      throw new Error(`not a gzip member at byte ${start}`);
    }
    const flags = data[offset + 3];
    offset += GZIP_HEADER_LENGTH;
    if (flags & GZIP_FEXTRA) {
      if (offset + 2 > data.length) throw truncated();
      offset += 2 + (data[offset] | (data[offset + 1] << 8));
    }
    for (const nulTerminated of [flags & GZIP_FNAME, flags & GZIP_FCOMMENT]) {
      if (!nulTerminated) continue;
      while (offset < data.length && data[offset] !== 0) offset += 1;
      offset += 1;
    }
    if (flags & GZIP_FHCRC) offset += 2;
    if (offset >= data.length) throw truncated();

    // The deflate stream self-terminates and the engine reports the input
    // bytes it consumed — the member boundary. @types/node types the
    // info:true result as Buffer; at runtime it is { buffer, engine }.
    let inflated: Uint8Array;
    let deflateLength: number;
    try {
      const result = inflateRawSync(data.subarray(offset), {
        info: true,
      }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
      inflated = result.buffer;
      deflateLength = result.engine.bytesWritten;
    } catch {
      throw truncated();
    }
    offset += deflateLength;

    // RFC 1952 member trailer: 4-byte CRC32, then 4-byte ISIZE.
    if (offset + 8 > data.length) throw truncated();
    offset += 8;

    members.push({
      offset: start,
      length: offset - start,
      lines: splitlines(decoder.decode(inflated)),
    });
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

function memberEntry(member: Member): MonthIndexMember {
  // Key names must match the reader's parseHistoryIndexJson guard exactly;
  // a mismatch is not an error there, just a permanent silent degradation
  // to full fetches.
  const entry: MonthIndexMember = {
    byteOffset: member.offset,
    byteLength: member.length,
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

function splitlines(text: string): string[] {
  const pieces = text.split("\n");
  if (pieces.length > 0 && pieces[pieces.length - 1] === "") {
    pieces.pop();
  }
  return pieces;
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
