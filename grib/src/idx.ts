/** One .idx record; `length` is undefined for the file's last record,
 * which is read to end of file. */
export interface IdxRecord {
  variable: string;
  level: string;
  forecast: string;
  offset: number;
  length: number | undefined;
}

/** The .idx has no such record — distinct from transport failures. */
export class MissingRecordError extends Error {}

export function parseIdx(text: string): IdxRecord[] {
  const rows: Array<[number, string, string, string]> = [];
  for (const line of text.split("\n")) {
    const parts = line.split(":");
    if (parts.length < 6) continue;
    rows.push([Number.parseInt(parts[1]!, 10), parts[3]!, parts[4]!, parts[5]!]);
  }
  return rows.map(([offset, variable, level, forecast], index) => ({
    variable,
    level,
    forecast,
    offset,
    length: index + 1 < rows.length ? rows[index + 1]![0] - offset : undefined,
  }));
}

export function findRecord(
  records: IdxRecord[],
  variable: string,
  level: string,
  forecast: string,
): IdxRecord {
  for (const record of records) {
    if (record.variable === variable && record.level === level && record.forecast === forecast) {
      return record;
    }
  }
  throw new MissingRecordError(`${variable}:${level}:${forecast} is not in the GRIB index`);
}

/** Inclusive HTTP Range header value; open-ended for the last record. */
export function byteRange(record: IdxRecord): string {
  if (record.length === undefined) return `bytes=${record.offset}-`;
  return `bytes=${record.offset}-${record.offset + record.length - 1}`;
}

/**
 * Of a paired U/V message's two idx records at a shared offset, the one
 * spanning the whole two-submessage message.
 */
export function pairSpan(uRecord: IdxRecord, vRecord: IdxRecord): IdxRecord {
  if (uRecord.length === undefined || vRecord.length === undefined) {
    return uRecord.length === undefined ? uRecord : vRecord;
  }
  return uRecord.length > vRecord.length ? uRecord : vRecord;
}

/** The subset of a WHATWG Response these helpers read. */
export interface IdxResponse {
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The injected fetch. */
export type IdxFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<IdxResponse>;

/** Fetches and parses a .idx sidecar (a plain, unranged GET). */
export async function fetchIndex(fetchImpl: IdxFetch, url: string): Promise<IdxRecord[]> {
  const response = await fetchImpl(url);
  if (response.status !== 200) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return parseIdx(await response.text());
}

/**
 * Fetches one record's bytes with an HTTP Range request; only 206 Partial
 * Content is success — a 200 means the server ignored Range and sent the
 * whole file.
 */
export async function fetchRecord(
  fetchImpl: IdxFetch,
  url: string,
  record: IdxRecord,
): Promise<Uint8Array> {
  const response = await fetchImpl(url, { headers: { Range: byteRange(record) } });
  if (response.status !== 206) {
    throw new Error(`${url} answered ${response.status} to a Range request`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
