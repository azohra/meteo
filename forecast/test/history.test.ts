import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseHistoryIndexJson, splitHistoryArchive } from "@azohra/meteo.briefing/history";
import {
  appendHistory,
  appendHistoryLines,
  indexPath,
  monthIndex,
  writeMonthIndex,
  type ArchivableProfile,
  type MonthIndex,
  type PublishedHistoryReader,
} from "../src/history.js";
import { compactJson } from "../src/publish.js";

function profile(siteId: string, referenceTime: string): ArchivableProfile {
  return {
    schemaVersion: 1,
    model: "hrdps-continental",
    run: { referenceTime, generatedAt: referenceTime },
    site: { id: siteId },
    hours: [],
  };
}

function archivedLine(document: unknown): Uint8Array {
  return gzipSync(Buffer.from(compactJson(document) + "\n"));
}

function readRuns(archive: string): string[] {
  // Read through the @azohra/meteo.core READER — the cross-validation half of
  // every test that follows.
  const members = splitHistoryArchive(readFileSync(archive));
  expect(members).not.toBeNull();
  return members!.flatMap((member) =>
    member.lines.map((line) => (JSON.parse(line) as ArchivableProfile).run.referenceTime),
  );
}

function readIndex(archive: string): MonthIndex {
  return JSON.parse(readFileSync(indexPath(archive), "utf-8")) as MonthIndex;
}

const noPublishedHistory: PublishedHistoryReader = () => new Uint8Array(0);

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "history-"));
}

describe("history append flow", () => {
  it("first touch seeds the archive from the published month", () => {
    const root = tmp();
    const fetched: Array<[string, string, string]> = [];
    const publishedHistory: PublishedHistoryReader = (model, siteId, month) => {
      fetched.push([model, siteId, month]);
      return archivedLine(profile(siteId, "2026-08-07T06:00:00Z"));
    };

    appendHistory(
      profile("dundee", "2026-08-07T12:00:00Z"),
      join(root, "data/hrdps-continental/history"),
      publishedHistory,
    );

    expect(fetched).toEqual([["hrdps-continental", "dundee", "2026-08"]]);
    expect(readRuns(join(root, "data/hrdps-continental/history/dundee/2026-08.jsonl.gz"))).toEqual([
      "2026-08-07T06:00:00Z",
      "2026-08-07T12:00:00Z",
    ]);
  });

  it("an unpublished month starts a fresh archive", () => {
    const root = tmp();

    appendHistory(
      profile("dundee", "2026-08-07T12:00:00Z"),
      join(root, "data/hrdps-continental/history"),
      noPublishedHistory,
    );

    expect(readRuns(join(root, "data/hrdps-continental/history/dundee/2026-08.jsonl.gz"))).toEqual([
      "2026-08-07T12:00:00Z",
    ]);
  });

  it("appends one readable JSON line per run without refetching", () => {
    const root = tmp();
    const fetches: string[] = [];
    const publishedHistory: PublishedHistoryReader = (_model, _site, month) => {
      fetches.push(month);
      return new Uint8Array(0);
    };

    const historyDir = join(root, "data/hrdps-continental/history");
    appendHistory(profile("dundee", "2026-08-07T12:00:00Z"), historyDir, publishedHistory);
    appendHistory(profile("dundee", "2026-08-07T18:00:00Z"), historyDir, publishedHistory);

    // The month is seeded from the dataset once; later appends reuse the
    // local archive.
    expect(fetches).toEqual(["2026-08"]);
    expect(readRuns(join(historyDir, "dundee/2026-08.jsonl.gz"))).toEqual([
      "2026-08-07T12:00:00Z",
      "2026-08-07T18:00:00Z",
    ]);
  });

  it("history lines seed from the published month then append", () => {
    // Observation datasets archive one observation object per line —
    // same first-touch seeding as profile history, caller-chosen grammar.
    const root = tmp();
    const fetched: Array<[string, string, string]> = [];
    const publishedHistory: PublishedHistoryReader = (model, siteId, month) => {
      fetched.push([model, siteId, month]);
      return archivedLine({ observedAt: "2026-08-09T19:50:21Z", aot: 1.1 });
    };

    appendHistoryLines(
      "goes18-aod",
      "dundee",
      "2026-08",
      [
        { observedAt: "2026-08-09T20:00:21Z", aot: 1.934 },
        { observedAt: "2026-08-09T20:10:21Z", aot: 2.906 },
      ],
      join(root, "history"),
      publishedHistory,
    );

    expect(fetched).toEqual([["goes18-aod", "dundee", "2026-08"]]);
    const members = splitHistoryArchive(
      readFileSync(join(root, "history/dundee/2026-08.jsonl.gz")),
    );
    const observedAt = members!.flatMap((member) =>
      member.lines.map((line) => (JSON.parse(line) as { observedAt: string }).observedAt),
    );
    expect(observedAt).toEqual([
      "2026-08-09T19:50:21Z", // the seeded published line survives
      "2026-08-09T20:00:21Z",
      "2026-08-09T20:10:21Z",
    ]);
  });

  it("history lines with nothing new touch nothing", () => {
    const root = tmp();
    const publishedHistory: PublishedHistoryReader = () => {
      throw new Error("an empty batch must not fetch or seed");
    };

    appendHistoryLines(
      "goes18-aod",
      "dundee",
      "2026-08",
      [],
      join(root, "history"),
      publishedHistory,
    );

    expect(existsSync(join(root, "history"))).toBe(false);
  });

  it("rotates archives by reference month", () => {
    const root = tmp();
    const historyDir = join(root, "data/hrdps-continental/history");
    appendHistory(profile("erie", "2026-08-31T18:00:00Z"), historyDir, noPublishedHistory);
    appendHistory(profile("erie", "2026-09-01T00:00:00Z"), historyDir, noPublishedHistory);
    appendHistory(profile("erie", "2027-01-01T00:00:00Z"), historyDir, noPublishedHistory);

    expect(readdirSync(join(historyDir, "erie")).sort()).toEqual([
      "2026-08.index.json",
      "2026-08.jsonl.gz",
      "2026-09.index.json",
      "2026-09.jsonl.gz",
      "2027-01.index.json",
      "2027-01.jsonl.gz",
    ]);
  });
});

describe("month index", () => {
  it("index offsets slice the archive into exact member boundaries", () => {
    // Round-trip: the index's (offset, length) pairs must cut the gzip
    // file into exactly the independent members the appends wrote — a
    // Range fetch of one entry decompresses to that run's line, whole.
    const root = tmp();

    // A real-shaped seed: the published month already holds one run, so
    // the archive is seeded bytes + appended members, like the live one.
    const publishedHistory: PublishedHistoryReader = (_model, siteId) =>
      archivedLine(profile(siteId, "2026-08-07T00:00:00Z"));
    const historyDir = join(root, "data/geps/history");
    appendHistory(profile("erie", "2026-08-07T06:00:00Z"), historyDir, publishedHistory);
    appendHistory(profile("erie", "2026-08-07T12:00:00Z"), historyDir, publishedHistory);

    const archive = join(historyDir, "erie/2026-08.jsonl.gz");
    const data = readFileSync(archive);
    const index = readIndex(archive);

    expect(index.schemaVersion).toBe(1);
    expect(index.archive).toBe("2026-08.jsonl.gz");
    expect(index.archiveLength).toBe(data.length);
    // Contiguous cover: members tile the file from byte 0 to the end.
    expect(index.members[0].byteOffset).toBe(0);
    for (let i = 1; i < index.members.length; i += 1) {
      expect(index.members[i].byteOffset).toBe(
        index.members[i - 1].byteOffset + index.members[i - 1].byteLength,
      );
    }
    const last = index.members[index.members.length - 1];
    expect(last.byteOffset + last.byteLength).toBe(data.length);
    // Each slice is a complete gzip member holding exactly its run.
    const sliced = index.members.map((entry) =>
      gunzipSync(data.subarray(entry.byteOffset, entry.byteOffset + entry.byteLength)),
    );
    expect(
      sliced.map((piece) => (JSON.parse(piece.toString()) as ArchivableProfile).run.referenceTime),
    ).toEqual(["2026-08-07T00:00:00Z", "2026-08-07T06:00:00Z", "2026-08-07T12:00:00Z"]);
    expect(index.members.map((entry) => entry.referenceTime)).toEqual([
      "2026-08-07T00:00:00Z",
      "2026-08-07T06:00:00Z",
      "2026-08-07T12:00:00Z",
    ]);
    expect(index.members.every((entry) => entry.lines === 1)).toBe(true);
    expect(index.members[1].generatedAt).toBe("2026-08-07T06:00:00Z");

    // Cross-validation with the @azohra/meteo.core reader: the sidecar this
    // writer publishes must use the exact keys parseHistoryIndexJson reads.
    // A mismatch is no error there, only a permanent silent degradation to
    // full fetches. The archive must also split into the same members
    // through splitHistoryArchive.
    const parsed = parseHistoryIndexJson(readFileSync(indexPath(archive), "utf-8"));
    expect(parsed).not.toBeNull();
    expect(
      parsed!.members.map((member) => ({
        byteOffset: member.byteOffset,
        byteLength: member.byteLength,
        referenceTime: member.referenceTime,
        generatedAt: member.generatedAt,
      })),
    ).toEqual(
      index.members.map((member) => ({
        byteOffset: member.byteOffset,
        byteLength: member.byteLength,
        referenceTime: member.referenceTime,
        generatedAt: member.generatedAt,
      })),
    );
    const readerMembers = splitHistoryArchive(data);
    expect(readerMembers).not.toBeNull();
    expect(
      readerMembers!.map((member) => ({
        byteOffset: member.byteOffset,
        byteLength: member.byteLength,
        lines: member.lines.length,
      })),
    ).toEqual(
      index.members.map((member) => ({
        byteOffset: member.byteOffset,
        byteLength: member.byteLength,
        lines: member.lines,
      })),
    );
  });

  it("every append rewrites the index to cover the whole archive", () => {
    const root = tmp();
    const historyDir = join(root, "data/geps/history");
    const archive = join(historyDir, "erie/2026-08.jsonl.gz");

    appendHistory(profile("erie", "2026-08-07T06:00:00Z"), historyDir, noPublishedHistory);
    expect(readIndex(archive).members).toHaveLength(1);

    appendHistory(profile("erie", "2026-08-07T12:00:00Z"), historyDir, noPublishedHistory);
    const index = readIndex(archive);
    expect(index.members).toHaveLength(2);
    expect(index.archiveLength).toBe(statSync(archive).size);

    // Deterministic: the index is a pure function of the archive bytes,
    // so recomputing it rewrites the identical document.
    const firstWrite = readFileSync(indexPath(archive));
    writeMonthIndex(archive);
    expect(readFileSync(indexPath(archive)).equals(firstWrite)).toBe(true);
  });

  it("observation batch members index their observedAt span", () => {
    // Observation datasets archive a whole batch of instants per member;
    // the index carries the batch's span, not a run identity.
    const root = tmp();

    appendHistoryLines(
      "goes18-aod",
      "erie",
      "2026-08",
      [
        { observedAt: "2026-08-09T20:00:21Z", aot: 1.934 },
        { observedAt: "2026-08-09T20:10:21Z", aot: 2.906 },
      ],
      join(root, "history"),
      noPublishedHistory,
    );

    const index = readIndex(join(root, "history/erie/2026-08.jsonl.gz"));
    expect(index.members).toEqual([
      {
        byteOffset: 0,
        byteLength: index.archiveLength,
        lines: 2,
        firstObservedAt: "2026-08-09T20:00:21Z",
        lastObservedAt: "2026-08-09T20:10:21Z",
      },
    ]);
  });

  it("index computation rejects a truncated member", () => {
    const whole = archivedLine(profile("erie", "2026-08-07T06:00:00Z"));
    expect(() => monthIndex(whole.subarray(0, whole.length - 4), "2026-08.jsonl.gz")).toThrowError(
      /truncated gzip member at byte 0/,
    );
  });
});
