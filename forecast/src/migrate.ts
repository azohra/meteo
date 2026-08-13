import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import { migrateDocument, type WireDocument } from "@azohra/meteo.briefing/contract";
import { SITE_FORECAST_SCHEMA_VERSION } from "./derive.js";
import { monthIndex, splitMembers } from "./history.js";
import { compactJson } from "./publish.js";

export {
  migrateDocument,
  migrateHour,
  migrateLevel,
  migrateSurface,
  type MigrateDocumentOptions,
  type WireDocument,
} from "@azohra/meteo.briefing/contract";

// Must match upload-data.sh's TTL pair.
export const SHORT_TTL = "public, max-age=300";
export const CLOSED_TTL = "public, max-age=31536000, immutable";

export function monthCacheControl(month: string, today: Date = new Date()): string {
  const first = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
  const previous = new Date(first - 24 * 60 * 60 * 1000);
  const openMonths = new Set([monthText(new Date(first)), monthText(previous)]);
  return openMonths.has(month) ? SHORT_TTL : CLOSED_TTL;
}

function monthText(day: Date): string {
  return `${String(day.getUTCFullYear()).padStart(4, "0")}-${String(day.getUTCMonth() + 1).padStart(2, "0")}`;
}

const HISTORY_EPOCH: readonly [number, number] = [2026, 1];

function candidateMonths(today: Date): string[] {
  const months: string[] = [];
  let [year, month] = HISTORY_EPOCH;
  const [endYear, endMonth] = [today.getUTCFullYear(), today.getUTCMonth() + 1];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
    [year, month] = month < 12 ? [year, month + 1] : [year + 1, 1];
  }
  return months;
}

export interface PublishedObjectStore {
  fetchPublished(path: string): Promise<Uint8Array | null>;
  putObject(
    key: string,
    body: Uint8Array,
    cacheControl: string,
    contentType: string,
  ): Promise<void> | void;
  s3Mode(): boolean;
}

export interface MigrateModelOptions {
  applyChanges: boolean;
  today?: Date;
  log?: (line: string) => void;
  transform?: (document: WireDocument) => WireDocument;
  targetSchemaVersion?: number;
  runMembers?: number;
}

interface PendingUpload {
  key: string;
  body: Uint8Array;
  cacheControl: string;
  contentType: string;
}

function profileValidator(): ValidateFunction {
  const schemaPath = fileURLToPath(
    import.meta.resolve("@azohra/meteo.briefing/schema/profile.schema.json"),
  );
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  return ajv.compile(schema);
}

function verifyDocuments(
  documents: readonly WireDocument[],
  validator: ValidateFunction,
  targetVersion: number,
  label: string,
): void {
  for (const document of documents) {
    const version = document["schemaVersion"];
    if (version !== targetVersion) {
      throw new Error(
        `${label}: an output document says schemaVersion ${JSON.stringify(version) ?? "undefined"}, ` +
          `not ${targetVersion}; nothing was uploaded`,
      );
    }
    if (!validator(document)) {
      const details = (validator.errors ?? [])
        .slice(0, 3)
        .map((error: ErrorObject) => error.message ?? "invalid")
        .join("; ");
      throw new Error(
        `${label}: an output document fails schema/profile.schema.json ` +
          `(${details}); nothing was uploaded`,
      );
    }
  }
}

function migratedArchive(
  archiveBytes: Uint8Array,
  label: string,
  transform: (document: WireDocument) => WireDocument,
  targetVersion: number,
): { bytes: Uint8Array; lines: number; alreadyTarget: number } {
  const chunks: Uint8Array[] = [];
  let lines = 0;
  let alreadyTarget = 0;
  for (const member of splitMembers(archiveBytes)) {
    const migratedLines: string[] = [];
    let changed = false;
    for (const line of member.lines) {
      lines += 1;
      const document = JSON.parse(line) as WireDocument;
      if (document["schemaVersion"] === targetVersion) {
        alreadyTarget += 1;
        migratedLines.push(line);
        continue;
      }
      let migrated: WireDocument;
      try {
        migrated = transform(document);
      } catch (error) {
        throw new Error(`${label}: ${(error as Error).message}`);
      }
      migratedLines.push(compactJson(migrated));
      changed = true;
    }
    if (changed) {
      chunks.push(gzipSync(Buffer.from(migratedLines.map((line) => line + "\n").join(""))));
    } else {
      chunks.push(archiveBytes.subarray(member.offset, member.offset + member.length));
    }
  }
  return { bytes: Buffer.concat(chunks), lines, alreadyTarget };
}

function requireUploadCredentials(store: PublishedObjectStore): void {
  if (!store.s3Mode()) {
    throw new Error(
      "the migration publishes through the authenticated S3 endpoint " +
        "(stale CDN reads must never seed an upload): set R2_ENDPOINT / " +
        "AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY and leave " +
        "METEO_DATA_BASE unset, or drop --apply",
    );
  }
}

function bytesEqual(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export async function migrateModel(
  model: string,
  siteIds: readonly string[],
  store: PublishedObjectStore,
  options: MigrateModelOptions,
): Promise<void> {
  const {
    applyChanges,
    today = new Date(),
    log = console.log,
    runMembers,
    transform = (document: WireDocument): WireDocument => migrateDocument(document, { runMembers }),
    targetSchemaVersion: targetVersion = SITE_FORECAST_SCHEMA_VERSION,
  } = options;
  const validator = profileValidator();
  const months = candidateMonths(today);
  const uploads: PendingUpload[] = [];
  const originals = new Map<string, Uint8Array>();
  let archives = 0;
  let lines = 0;
  let alreadyTarget = 0;
  let currentDocuments = 0;
  let currentAtTarget = 0;

  for (const siteId of siteIds) {
    const siteKey = `${model}/sites/${siteId}.json`;
    const payload = await store.fetchPublished(siteKey);
    if (payload === null) {
      log(`${model}/${siteId}: no current document published.`);
    } else {
      currentDocuments += 1;
      const document = JSON.parse(new TextDecoder().decode(payload)) as WireDocument;
      if (document["schemaVersion"] === targetVersion) {
        verifyDocuments([document], validator, targetVersion, siteKey);
        currentAtTarget += 1;
        log(`${model}/${siteId}: current document already v${targetVersion}.`);
      } else {
        let migrated: WireDocument;
        try {
          migrated = transform(document);
        } catch (error) {
          throw new Error(`${siteKey}: ${(error as Error).message}`);
        }
        verifyDocuments([migrated], validator, targetVersion, siteKey);
        originals.set(siteKey, payload);
        uploads.push({
          key: siteKey,
          body: Buffer.from(compactJson(migrated) + "\n"),
          cacheControl: SHORT_TTL,
          contentType: "application/json",
        });
        log(`${model}/${siteId}: current document migrates to v${targetVersion}.`);
      }
    }

    for (const month of months) {
      const archiveKey = `${model}/history/${siteId}/${month}.jsonl.gz`;
      const archiveBytes = await store.fetchPublished(archiveKey);
      if (archiveBytes === null) {
        continue;
      }
      const migrated = migratedArchive(archiveBytes, archiveKey, transform, targetVersion);
      const outputDocuments = splitMembers(migrated.bytes).flatMap((member) =>
        member.lines.map((line) => JSON.parse(line) as WireDocument),
      );
      if (outputDocuments.length !== migrated.lines) {
        throw new Error(
          `${archiveKey}: line count changed in migration ` +
            `(${migrated.lines} -> ${outputDocuments.length}); nothing was uploaded`,
        );
      }
      verifyDocuments(outputDocuments, validator, targetVersion, archiveKey);
      archives += 1;
      lines += migrated.lines;
      alreadyTarget += migrated.alreadyTarget;
      if (!bytesEqual(archiveBytes, migrated.bytes)) {
        const cacheControl = monthCacheControl(month, today);
        originals.set(archiveKey, archiveBytes);
        uploads.push({
          key: archiveKey,
          body: migrated.bytes,
          cacheControl,
          contentType: "application/gzip",
        });
        const index = monthIndex(migrated.bytes, `${month}.jsonl.gz`);
        uploads.push({
          key: `${model}/history/${siteId}/${month}.index.json`,
          body: Buffer.from(JSON.stringify(index, null, 2) + "\n"),
          cacheControl,
          contentType: "application/json",
        });
      }
      log(
        `${model}/${siteId} ${month}: ${migrated.lines} line(s), ` +
          `${migrated.alreadyTarget} already v${targetVersion}.`,
      );
    }
  }

  log(
    `${model}: ${archives} archive(s), ${lines} line(s), ${alreadyTarget} already ` +
      `v${targetVersion}; ${currentDocuments} current document(s), ${currentAtTarget} ` +
      `already v${targetVersion}.`,
  );

  if (!applyChanges) {
    const would = uploads.length > 0 ? uploads.map((upload) => upload.key).join(", ") : "nothing";
    log(`${model}: dry run — would upload ${would}.`);
    return;
  }
  if (uploads.length === 0) {
    log(`${model}: nothing to upload — everything published is already v${targetVersion}.`);
    return;
  }

  requireUploadCredentials(store);
  for (const { key, body, cacheControl, contentType } of uploads) {
    const original = originals.get(key);
    if (original !== undefined && !bytesEqual(await store.fetchPublished(key), original)) {
      throw new Error(
        `${key} changed on the bucket since it was read (a scheduled ` +
          "build published?); the migration stops here — re-run it " +
          "against the fresh dataset",
      );
    }
    await store.putObject(key, body, cacheControl, contentType);
    log(`${key}: uploaded (${cacheControl}).`);
  }
}
