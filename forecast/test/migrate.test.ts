import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseHistoryIndexJson, splitHistoryArchive } from "@azohra/meteo.briefing/history";
import { appendHistory, type ArchivableProfile } from "../src/history.js";
import {
  CLOSED_TTL,
  SHORT_TTL,
  migrateDocument,
  migrateHour,
  migrateLevel,
  migrateModel,
  migrateSurface,
  monthCacheControl,
  type PublishedObjectStore,
  type WireDocument,
} from "../src/migrate.js";
import { compactJson } from "../src/publish.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const V2_DETERMINISTIC = JSON.parse(
  readFileSync(join(REPO_ROOT, "scenarios/generated/convective-cycle.profile.json"), "utf-8"),
) as WireDocument;
const V2_ENSEMBLE = JSON.parse(
  readFileSync(join(REPO_ROOT, "scenarios/generated/ensemble-tight.profile.json"), "utf-8"),
) as WireDocument;

const TODAY = new Date(Date.UTC(2026, 7, 11));
const SITE_KEY = "hrrr-conus/sites/erie.json";
const MONTH_KEY = "hrrr-conus/history/erie/2026-08.jsonl.gz";
const INDEX_KEY = "hrrr-conus/history/erie/2026-08.index.json";

const V1_RENAMES: Record<string, string> = {
  windSpeedMps: "windSpeedMs",
  windGustMps: "windGustMs",
};

/** seaLevelPressureHpa back to v1 pascals (percentile blocks scale their
 *  p-values only). */
function pa(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const out: WireDocument = {};
    for (const [key, entry] of Object.entries(value as WireDocument)) {
      out[key] =
        key.startsWith("p") && entry !== null && entry !== undefined
          ? (entry as number) * 100.0
          : entry;
    }
    return out;
  }
  return (value as number) * 100.0;
}

/** The inverse vocabulary change, for fixture construction only. */
function asV1(document: WireDocument): WireDocument {
  const out = structuredClone(document);
  out["schemaVersion"] = 1;
  for (const hour of out["hours"] as WireDocument[]) {
    const surface: WireDocument = {};
    for (const [key, value] of Object.entries(hour["surface"] as WireDocument)) {
      if (key === "seaLevelPressureHpa") {
        surface["pressurePa"] = pa(value);
      } else {
        surface[V1_RENAMES[key] ?? key] = value;
      }
    }
    hour["surface"] = surface;
    hour["levels"] = (hour["levels"] as WireDocument[]).map((level) =>
      Object.fromEntries(
        Object.entries(level).map(([key, value]) => [V1_RENAMES[key] ?? key, value]),
      ),
    );
    hour["derived"] = Object.fromEntries(
      Object.entries(hour["derived"] as WireDocument).map(([key, value]) => [
        key === "thermalVelocityMps" ? "thermalVelocityMs" : key,
        value,
      ]),
    );
  }
  return out;
}

/** One archive gzip member holding exactly these documents' lines — the
 *  byte shape the history writer appends. */
function gzipMember(...documents: WireDocument[]): Uint8Array {
  return gzipSync(Buffer.from(documents.map((document) => compactJson(document) + "\n").join("")));
}

/**
 * A month archive built with history.ts's OWN writer — one appendHistory
 * per document, so each document is one independent gzip member, exactly
 * the bytes the pipeline publishes.
 */
function writtenArchive(...documents: WireDocument[]): Uint8Array {
  const historyDir = mkdtempSync(join(tmpdir(), "migrate-"));
  let archivePath = "";
  for (const document of documents) {
    const profile = document as unknown as ArchivableProfile;
    appendHistory(profile, historyDir, () => new Uint8Array(0));
    archivePath = join(
      historyDir,
      profile.site.id,
      `${profile.run.referenceTime.slice(0, 7)}.jsonl.gz`,
    );
  }
  return readFileSync(archivePath);
}

/** The archive's documents, read through the @azohra/meteo.core READER — the
 *  cross-validation half of every cutover assertion. */
function archivedDocuments(data: Uint8Array): WireDocument[] {
  const members = splitHistoryArchive(data);
  expect(members).not.toBeNull();
  return members!.flatMap((member) => member.lines.map((line) => JSON.parse(line) as WireDocument));
}

interface RecordedPut {
  key: string;
  cacheControl: string;
  contentType: string;
}

interface Bucket {
  objects: Map<string, Uint8Array>;
  puts: RecordedPut[];
  store: PublishedObjectStore;
  log: string[];
}

/** A published dataset the cutover reads and rewrites in memory: a v1
 *  current document and a month archive mixing a v1 line with a v2 one. */
function bucket({ credentials = true }: { credentials?: boolean } = {}): Bucket {
  const objects = new Map<string, Uint8Array>([
    [SITE_KEY, Buffer.from(compactJson(asV1(V2_DETERMINISTIC)) + "\n")],
    [MONTH_KEY, writtenArchive(asV1(V2_DETERMINISTIC), V2_DETERMINISTIC)],
  ]);
  const puts: RecordedPut[] = [];
  const store: PublishedObjectStore = {
    fetchPublished: async (path) => objects.get(path) ?? null,
    putObject: (key, body, cacheControl, contentType) => {
      puts.push({ key, cacheControl, contentType });
      objects.set(key, body);
    },
    s3Mode: () => credentials,
  };
  return { objects, puts, store, log: [] };
}

function migrateErie(fake: Bucket, applyChanges: boolean): Promise<void> {
  return migrateModel("hrrr-conus", ["erie"], fake.store, {
    applyChanges,
    today: TODAY,
    log: (line) => fake.log.push(line),
  });
}

describe("wire v1 -> v2 document transform", () => {
  it("renames surface speeds and converts pressurePa to hectopascals", () => {
    const surface = migrateSurface({
      temperatureC: 21.5,
      windSpeedMs: 3.2,
      windGustMs: 5.4,
      pressurePa: 101325,
    });
    expect(surface).toEqual({
      temperatureC: 21.5,
      windSpeedMps: 3.2,
      windGustMps: 5.4,
      seaLevelPressureHpa: 1013.25,
    });
  });

  it("pressure publishes at 2 decimals through the CPython rounding path", () => {
    // roundContract semantics: half-even on the exact decimal value —
    // 100012.5 Pa is exactly 1000.125 hPa, which rounds DOWN to the even
    // cent (Math.round or toFixed would say 1000.13).
    expect(migrateSurface({ pressurePa: 100012.5 })["seaLevelPressureHpa"]).toBe(1000.12);
    expect(migrateSurface({ pressurePa: 100012 })["seaLevelPressureHpa"]).toBe(1000.12);
    expect(migrateSurface({ pressurePa: 99987 })["seaLevelPressureHpa"]).toBe(999.87);
    // Null pressure survives as null under the new name.
    expect(migrateSurface({ pressurePa: null })).toEqual({ seaLevelPressureHpa: null });
  });

  it("ensemble pressure blocks scale their percentiles only", () => {
    expect(
      migrateSurface({ pressurePa: { members: 9, p10: 90050, p50: null, p90: 101325 } }),
    ).toEqual({
      seaLevelPressureHpa: { members: 9, p10: 900.5, p50: null, p90: 1013.25 },
    });
  });

  it("level speeds rename; level pressureHpa is already correct and untouched", () => {
    expect(migrateLevel({ pressureHpa: 850, heightM: 1457.3, windSpeedMs: 10.1 })).toEqual({
      pressureHpa: 850,
      heightM: 1457.3,
      windSpeedMps: 10.1,
    });
  });

  it("derived thermalVelocityMs renames and nested ensemble members recurse", () => {
    const hour = migrateHour({
      validAt: "2026-08-11T18:00:00Z",
      derived: { thermalVelocityMs: 1.5, cloudBaseM: 2000 },
      members: [{ surface: { windSpeedMs: 4 }, derived: { thermalVelocityMs: 0.9 } }],
    });
    expect(hour["derived"]).toEqual({ thermalVelocityMps: 1.5, cloudBaseM: 2000 });
    expect(hour["members"]).toEqual([
      { surface: { windSpeedMps: 4 }, derived: { thermalVelocityMps: 0.9 } },
    ]);
  });

  it("unknown fields pass through untouched, everywhere", () => {
    const document = migrateDocument({
      schemaVersion: 1,
      model: "hrrr-conus",
      novelTopLevel: true,
      hours: [
        {
          validAt: "2026-08-11T18:00:00Z",
          surface: { windSpeedMs: 3, futureField: "kept" },
          levels: [{ pressureHpa: 700, futureLevelField: 7 }],
          derived: { futureDerivedField: null },
          futureHourField: [1, 2],
        },
      ],
    });
    expect(document["novelTopLevel"]).toBe(true);
    const hour = (document["hours"] as WireDocument[])[0]!;
    expect(hour["futureHourField"]).toEqual([1, 2]);
    expect((hour["surface"] as WireDocument)["futureField"]).toBe("kept");
    expect((hour["levels"] as WireDocument[])[0]!["futureLevelField"]).toBe(7);
    expect((hour["derived"] as WireDocument)["futureDerivedField"]).toBeNull();
  });

  it("renames preserve the published key order in place", () => {
    const surface = migrateSurface({ first: 1, windSpeedMs: 2, pressurePa: 100000, last: 3 });
    expect(Object.keys(surface)).toEqual(["first", "windSpeedMps", "seaLevelPressureHpa", "last"]);
    const level = migrateLevel({ pressureHpa: 850, windSpeedMs: 1, windDirectionDeg: 90 });
    expect(Object.keys(level)).toEqual(["pressureHpa", "windSpeedMps", "windDirectionDeg"]);
  });

  it("a v2 document passes through unchanged — the same object", () => {
    expect(migrateDocument(V2_DETERMINISTIC)).toBe(V2_DETERMINISTIC);
    expect(migrateDocument(V2_ENSEMBLE)).toBe(V2_ENSEMBLE);
  });

  it("reverse-migrated fixtures round-trip to their committed v2 selves", () => {
    expect(migrateDocument(asV1(V2_DETERMINISTIC))).toEqual(V2_DETERMINISTIC);
  });

  it("refuses any schemaVersion that is neither 1 nor 2", () => {
    expect(() => migrateDocument({ schemaVersion: 3 })).toThrowError(
      /cannot migrate schemaVersion 3/,
    );
    expect(() => migrateDocument({})).toThrowError(/cannot migrate schemaVersion/);
  });
});

describe("the ensemble guard", () => {
  const ENSEMBLE_MEMBERS = (V2_ENSEMBLE["run"] as WireDocument)["members"] as number;

  /** The reference bucket's blocker: a stored v1 ensemble from before the
   *  run.members declaration. */
  function preDeclarationEnsemble(): WireDocument {
    const undeclared = asV1(V2_ENSEMBLE);
    delete (undeclared["run"] as WireDocument)["members"];
    return undeclared;
  }

  it("a v1 ensemble with declared run.members migrates", () => {
    const migrated = migrateDocument(asV1(V2_ENSEMBLE));

    expect(migrated["schemaVersion"]).toBe(2);
    expect(migrated).toEqual(V2_ENSEMBLE);
  });

  it("percentile blocks without run.members refuse to migrate", () => {
    // The v2 readers classify ensembles solely by run.members; a stored
    // pre-declaration v1 ensemble migrated silently would be misread as
    // deterministic.
    expect(() => migrateDocument(preDeclarationEnsemble())).toThrowError(
      /pre-declaration ensemble document/,
    );
  });

  it("a pre-declaration ensemble migrates once the operator declares the member count", () => {
    const migrated = migrateDocument(preDeclarationEnsemble(), {
      runMembers: ENSEMBLE_MEMBERS,
    });

    expect(migrated).toEqual(V2_ENSEMBLE);
  });

  it("refuses a declared count the percentile blocks contradict", () => {
    // Per-position block members can only run BELOW run.members (censoring
    // drops members), never above — a block reporting more contributors
    // than the declared count proves the count wrong.
    expect(() =>
      migrateDocument(preDeclarationEnsemble(), { runMembers: ENSEMBLE_MEMBERS - 1 }),
    ).toThrowError(/contributing members, more than the declared/);
  });

  it("a document's own run.members outranks the declared count", () => {
    const migrated = migrateDocument(asV1(V2_ENSEMBLE), { runMembers: ENSEMBLE_MEMBERS + 30 });

    expect(migrated).toEqual(V2_ENSEMBLE);
  });

  it("a declared count leaves deterministic documents deterministic", () => {
    const migrated = migrateDocument(asV1(V2_DETERMINISTIC), { runMembers: ENSEMBLE_MEMBERS });

    expect("members" in (migrated["run"] as WireDocument)).toBe(false);
    expect(migrated).toEqual(V2_DETERMINISTIC);
  });

  it("a v1 deterministic document without run.members still migrates", () => {
    const migrated = migrateDocument(asV1(V2_DETERMINISTIC));

    expect("members" in (migrated["run"] as WireDocument)).toBe(false);
    expect(migrated).toEqual(V2_DETERMINISTIC);
  });

  it("the declared count carries a pre-declaration archive through the cutover", async () => {
    const archiveKey = "reps/history/erie/2026-08.jsonl.gz";
    const objects = new Map<string, Uint8Array>([
      [archiveKey, gzipMember(preDeclarationEnsemble())],
    ]);
    const store: PublishedObjectStore = {
      fetchPublished: async (path) => objects.get(path) ?? null,
      putObject: (key, body) => void objects.set(key, body),
      s3Mode: () => true,
    };

    await migrateModel("reps", ["erie"], store, {
      applyChanges: true,
      today: TODAY,
      runMembers: ENSEMBLE_MEMBERS,
      log: () => {},
    });

    expect(archivedDocuments(objects.get(archiveKey)!)).toEqual([V2_ENSEMBLE]);
  });

  it("without the declared count the cutover names the archive and refuses", async () => {
    const archiveKey = "reps/history/erie/2026-08.jsonl.gz";
    const objects = new Map<string, Uint8Array>([
      [archiveKey, gzipMember(preDeclarationEnsemble())],
    ]);
    const store: PublishedObjectStore = {
      fetchPublished: async (path) => objects.get(path) ?? null,
      putObject: () => {
        throw new Error("refusal uploaded");
      },
      s3Mode: () => true,
    };

    await expect(
      migrateModel("reps", ["erie"], store, { applyChanges: false, today: TODAY, log: () => {} }),
    ).rejects.toThrowError(/2026-08\.jsonl\.gz: hours carry ensemble percentile blocks/);
  });
});

describe("month cache control", () => {
  it("current and previous months stay short; anything older is closed", () => {
    expect(monthCacheControl("2026-08", TODAY)).toBe(SHORT_TTL);
    expect(monthCacheControl("2026-07", TODAY)).toBe(SHORT_TTL);
    expect(monthCacheControl("2026-06", TODAY)).toBe(CLOSED_TTL);
    // Across a year boundary the previous month is last December.
    expect(monthCacheControl("2025-12", new Date(Date.UTC(2026, 0, 3)))).toBe(SHORT_TTL);
  });
});

describe("the archive cutover", () => {
  it("dry run is the default posture and writes nothing", async () => {
    const fake = bucket({ credentials: false });
    fake.store.putObject = () => {
      throw new Error("dry run uploaded");
    };

    await migrateErie(fake, false);

    expect(fake.log).toContain("hrrr-conus/erie: current document migrates to v2.");
    expect(fake.log).toContain("hrrr-conus/erie 2026-08: 2 line(s), 1 already v2.");
    expect(fake.log).toContain(
      "hrrr-conus: 1 archive(s), 2 line(s), 1 already v2; 1 current document(s), 0 already v2.",
    );
    expect(fake.log).toContain(
      `hrrr-conus: dry run — would upload ${SITE_KEY}, ${MONTH_KEY}, ${INDEX_KEY}.`,
    );
  });

  it("apply migrates in place, preserving already-v2 member bytes", async () => {
    const fake = bucket();

    await migrateErie(fake, true);

    expect(fake.puts.map((put) => put.key)).toEqual([SITE_KEY, MONTH_KEY, INDEX_KEY]);
    // The current document and every archive line say v2 and carry exactly
    // the values the v2 pipeline would have published — the archive read
    // back through the @azohra/meteo.core READER, the other end of the wire.
    expect(JSON.parse(new TextDecoder().decode(fake.objects.get(SITE_KEY)))).toEqual(
      V2_DETERMINISTIC,
    );
    expect(archivedDocuments(fake.objects.get(MONTH_KEY)!)).toEqual([
      V2_DETERMINISTIC,
      V2_DETERMINISTIC,
    ]);
    // The already-v2 gzip member survives byte-for-byte as the archive tail.
    const archive = fake.objects.get(MONTH_KEY)!;
    const untouched = gzipMember(V2_DETERMINISTIC);
    expect(Buffer.from(archive.subarray(archive.length - untouched.length)).equals(untouched)).toBe(
      true,
    );
    // The republished sidecar index covers the rewritten archive exactly,
    // and speaks the exact keys the reader's parseHistoryIndexJson reads.
    const index = parseHistoryIndexJson(new TextDecoder().decode(fake.objects.get(INDEX_KEY)));
    expect(index).not.toBeNull();
    const rawIndex = JSON.parse(new TextDecoder().decode(fake.objects.get(INDEX_KEY))) as {
      archiveLength: number;
      members: { lines: number }[];
    };
    expect(rawIndex.archiveLength).toBe(archive.length);
    expect(rawIndex.members.reduce((total, member) => total + member.lines, 0)).toBe(2);
    const readerMembers = splitHistoryArchive(archive)!;
    expect(
      index!.members.map((member) => ({
        byteOffset: member.byteOffset,
        byteLength: member.byteLength,
      })),
    ).toEqual(
      readerMembers.map((member) => ({
        byteOffset: member.byteOffset,
        byteLength: member.byteLength,
      })),
    );
    expect(readerMembers.reduce((total, member) => total + member.lines.length, 0)).toBe(2);
    // TTLs and content types follow the upload script's arithmetic.
    expect(fake.puts[0]).toEqual({
      key: SITE_KEY,
      cacheControl: SHORT_TTL,
      contentType: "application/json",
    });
    expect(fake.puts[1]).toEqual({
      key: MONTH_KEY,
      cacheControl: monthCacheControl("2026-08", TODAY),
      contentType: "application/gzip",
    });
    expect(fake.puts[2]).toEqual({
      key: INDEX_KEY,
      cacheControl: monthCacheControl("2026-08", TODAY),
      contentType: "application/json",
    });
  });

  it("a second run reports all-v2 and uploads nothing", async () => {
    const fake = bucket();
    await migrateErie(fake, true);
    fake.puts.length = 0;
    fake.log.length = 0;

    await migrateErie(fake, true);

    expect(fake.puts).toEqual([]);
    expect(fake.log).toContain("hrrr-conus/erie: current document already v2.");
    expect(fake.log).toContain(
      "hrrr-conus: 1 archive(s), 2 line(s), 2 already v2; 1 current document(s), 1 already v2.",
    );
    expect(fake.log).toContain(
      "hrrr-conus: nothing to upload — everything published is already v2.",
    );
  });

  it("a contract-invalid output stops before any upload", async () => {
    const fake = bucket();
    const broken = asV1(V2_DETERMINISTIC);
    delete (broken["site"] as WireDocument)["name"]; // migrates cleanly, fails the contract
    fake.objects.set(MONTH_KEY, writtenArchive(broken));

    await expect(migrateErie(fake, true)).rejects.toThrowError(/profile\.schema\.json/);
    expect(fake.puts).toEqual([]);
  });

  it("an unknown schema version stops before any upload", async () => {
    const fake = bucket();
    const stranger = asV1(V2_DETERMINISTIC);
    stranger["schemaVersion"] = 3;
    fake.objects.set(MONTH_KEY, writtenArchive(stranger));

    await expect(migrateErie(fake, true)).rejects.toThrowError(/cannot migrate schemaVersion 3/);
    expect(fake.puts).toEqual([]);
  });

  it("a racing publish aborts instead of being overwritten", async () => {
    const fake = bucket();
    const fetched: string[] = [];
    const fetch = fake.store.fetchPublished.bind(fake.store);
    fake.store.fetchPublished = async (path) => {
      if (path === MONTH_KEY && fetched.includes(path)) {
        // A scheduled build appended between the read and the upload.
        fake.objects.set(
          MONTH_KEY,
          Buffer.concat([fake.objects.get(MONTH_KEY)!, gzipMember(V2_DETERMINISTIC)]),
        );
      }
      fetched.push(path);
      return fetch(path);
    };

    await expect(migrateErie(fake, true)).rejects.toThrowError(/changed on the bucket/);
    // The current document precedes the archive in upload order; the racing
    // archive itself was never overwritten.
    expect(fake.puts.map((put) => put.key)).toEqual([SITE_KEY]);
  });

  it("an empty dataset dry-runs to nothing published, nothing to upload", async () => {
    const fake = bucket({ credentials: false });
    fake.objects.clear();

    await migrateErie(fake, false);

    expect(fake.log).toContain("hrrr-conus/erie: no current document published.");
    expect(fake.log).toContain("hrrr-conus: dry run — would upload nothing.");
    expect(fake.puts).toEqual([]);
  });

  it("apply without credentials names the fix", async () => {
    const fake = bucket({ credentials: false });

    await expect(migrateErie(fake, true)).rejects.toThrowError(/drop --apply/);
    expect(fake.puts).toEqual([]);
  });
});
