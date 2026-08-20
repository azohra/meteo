import { inflateRawSync } from "node:zlib";

/**
 * The month-archive byte format and its sidecar index — the one home for
 * the gzip member walk and the index shape the writer stamps and the
 * reader honors. The walk carries reader semantics (a result, null on
 * damage); the writer's `splitMembers` wraps it and throws, because its
 * archives are the publishing pipeline's own writes and damage is a bug.
 */

/** One independent gzip member of a month archive, split and decompressed. */
export interface HistoryArchiveMember {
  /** Byte offset of the member's first byte within the archive. */
  byteOffset: number;
  /** Compressed length of the member, header and trailer included. */
  byteLength: number;
  /** The member's decompressed non-empty lines, one document per line. */
  lines: string[];
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
 * Splits a month archive into its independent gzip members and decompresses
 * each; returns `null` on structurally corrupt bytes, never throws, and
 * accepts any archive slice that starts on a member boundary.
 */
export function splitHistoryArchive(bytes: Uint8Array): HistoryArchiveMember[] | null {
  const members: HistoryArchiveMember[] = [];
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset < bytes.length) {
    const start = offset;
    if (offset + GZIP_HEADER_LENGTH > bytes.length) return null;
    if (
      bytes[offset] !== GZIP_ID1 ||
      bytes[offset + 1] !== GZIP_ID2 ||
      bytes[offset + 2] !== GZIP_DEFLATE_METHOD
    ) {
      return null;
    }
    const flags = bytes[offset + 3];
    offset += GZIP_HEADER_LENGTH;
    if (flags & GZIP_FEXTRA) {
      if (offset + 2 > bytes.length) return null;
      offset += 2 + (bytes[offset] | (bytes[offset + 1] << 8));
    }
    for (const nulTerminated of [flags & GZIP_FNAME, flags & GZIP_FCOMMENT]) {
      if (!nulTerminated) continue;
      while (offset < bytes.length && bytes[offset] !== 0) offset++;
      offset++;
    }
    if (flags & GZIP_FHCRC) offset += 2;
    if (offset >= bytes.length) return null;

    // The deflate stream self-terminates and the engine reports the input
    // bytes it consumed — the member boundary DecompressionStream never
    // surfaces. @types/node types the info:true result as Buffer; at runtime
    // it is { buffer, engine }.
    let inflated: Uint8Array;
    let deflateLength: number;
    try {
      const result = inflateRawSync(bytes.subarray(offset), {
        info: true,
      }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
      inflated = result.buffer;
      deflateLength = result.engine.bytesWritten;
    } catch {
      return null;
    }
    offset += deflateLength;

    // RFC 1952 member trailer: 4-byte CRC32, then ISIZE = decompressed
    // length mod 2^32, checked so a misaligned split cannot pass silently.
    if (offset + 8 > bytes.length) return null;
    const isize =
      (bytes[offset + 4] |
        (bytes[offset + 5] << 8) |
        (bytes[offset + 6] << 16) |
        (bytes[offset + 7] << 24)) >>>
      0;
    if (isize !== inflated.length >>> 0) return null;
    offset += 8;

    members.push({
      byteOffset: start,
      byteLength: offset - start,
      lines: decoder
        .decode(inflated)
        .split("\n")
        .filter((line) => line.length > 0),
    });
  }
  return members;
}

/** The sidecar index's schema stamp — whole-number versioned: any bump is breaking, and a reader refuses a number it does not know. */
export const INDEX_SCHEMA_VERSION = 1;

/**
 * One member's sidecar index entry. `referenceTime`/`generatedAt` identify
 * a single-run member; `firstObservedAt`/`lastObservedAt` span an
 * observation batch; a multi-line run member carries only its bytes.
 */
export interface MonthIndexMember {
  byteOffset: number;
  byteLength: number;
  /** Line count of the member; absent in indexes written before it was stamped. */
  lines?: number;
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

/** The reader's parsed view of a sidecar index: the members it can place, archive order. */
export interface HistoryIndex {
  members: MonthIndexMember[];
}

/**
 * Guard for the advisory sidecar index — never throws, `null` only on a
 * document that is not the index shape or declares a schemaVersion this
 * reader does not know (an unstamped index predates the stamp and still
 * reads). Members are judged one by one: an entry whose byte placement is
 * unusable is skipped, the rest survive — the index is advice, and partial
 * advice still narrows a fetch.
 */
export function parseHistoryIndexJson(text: string): HistoryIndex | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const document = value as { schemaVersion?: unknown; members?: unknown };
  if (document.schemaVersion !== undefined && document.schemaVersion !== INDEX_SCHEMA_VERSION) {
    return null;
  }
  if (!Array.isArray(document.members)) return null;
  const members: MonthIndexMember[] = [];
  for (const candidate of document.members) {
    const member = usableIndexMember(candidate);
    if (member !== null) members.push(member);
  }
  return { members };
}

/** One entry's validated copy, or null when its byte placement is unusable; malformed optional fields drop, the entry stays. */
function usableIndexMember(value: unknown): MonthIndexMember | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  const { byteOffset, byteLength } = entry;
  if (typeof byteOffset !== "number" || !Number.isInteger(byteOffset) || byteOffset < 0) {
    return null;
  }
  if (typeof byteLength !== "number" || !Number.isInteger(byteLength) || byteLength <= 0) {
    return null;
  }
  const member: MonthIndexMember = { byteOffset, byteLength };
  if (typeof entry.lines === "number" && Number.isInteger(entry.lines) && entry.lines >= 0) {
    member.lines = entry.lines;
  }
  if (typeof entry.referenceTime === "string") member.referenceTime = entry.referenceTime;
  if (typeof entry.generatedAt === "string" || entry.generatedAt === null) {
    member.generatedAt = entry.generatedAt;
  }
  if (typeof entry.firstObservedAt === "string") member.firstObservedAt = entry.firstObservedAt;
  if (typeof entry.lastObservedAt === "string") member.lastObservedAt = entry.lastObservedAt;
  return member;
}
