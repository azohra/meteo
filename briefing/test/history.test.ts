import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  loadHistory,
  loadForecastHistory,
  loadSmokeHistory,
  parseHistoryIndexJson,
  splitHistoryArchive,
  type HistoryFetch,
  type HistoryResponse,
  type LoadedHistory,
  type HistoryDocument,
} from "../src/history/index.js";
import { parseSmokeDocumentJson } from "../src/contract.js";
import { TransportHttpError, type DocumentMiss } from "../src/transport.js";

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

const RAQDPS_ARCHIVE = fixture("raqdps-erie-2026-08.jsonl.gz");
const RAQDPS_INDEX = readFileSync(
  join(__dirname, "fixtures", "raqdps-erie-2026-08.index.json"),
  "utf-8",
);
const HRDPS_WEST_ARCHIVE = fixture("hrdps-west-dundee-2026-08.jsonl.gz");
const GOES_ARCHIVE = fixture("goes18-aod-erie-2026-08.jsonl.gz");

const BASE = "https://example.test/data";
const RAQDPS_URL = `${BASE}/raqdps/history/erie/2026-08.jsonl.gz`;
const RAQDPS_INDEX_URL = `${BASE}/raqdps/history/erie/2026-08.index.json`;

function hit<T extends HistoryDocument>(result: LoadedHistory<T> | DocumentMiss): LoadedHistory<T> {
  if ("miss" in result) throw new Error(`unexpected miss: ${JSON.stringify(result)}`);
  return result;
}

interface StubFile {
  status?: number;
  bytes?: Uint8Array;
  servesRange?: boolean;
}

function stubFetch(files: Record<string, StubFile>) {
  const calls: { url: string; range?: string }[] = [];
  const respond = (status: number, bytes?: Uint8Array): HistoryResponse => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => (bytes ?? new Uint8Array(0)).slice().buffer as ArrayBuffer,
  });
  const fetch: HistoryFetch = async (url, init) => {
    calls.push({ url, ...(init?.headers?.Range ? { range: init.headers.Range } : {}) });
    const file = files[url];
    if (file === undefined || file.status === 404) return respond(404);
    if (file.status !== undefined && file.status !== 200) return respond(file.status);
    const bytes = file.bytes ?? new Uint8Array(0);
    const range = init?.headers?.Range;
    if (range !== undefined && file.servesRange !== false) {
      const start = Number(/^bytes=(\d+)-$/.exec(range)![1]);
      if (start >= bytes.length) return respond(416);
      return respond(206, bytes.subarray(start));
    }
    return respond(200, bytes);
  };
  return { fetch, calls };
}

function republishedMember(line: string, generatedAt: string): Uint8Array {
  const document = JSON.parse(line) as { run: { generatedAt: string } };
  document.run.generatedAt = generatedAt;
  return new Uint8Array(gzipSync(`${JSON.stringify(document)}\n`));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function archiveLines(bytes: Uint8Array): string[] {
  const members = splitHistoryArchive(bytes);
  if (members === null) throw new Error("fixture failed to split");
  return members.flatMap((member) => member.lines);
}

describe("splitHistoryArchive", () => {
  it("splits the real raqdps month into its two hand-measured members", () => {
    const members = splitHistoryArchive(RAQDPS_ARCHIVE)!;
    expect(members.map(({ byteOffset, byteLength }) => ({ byteOffset, byteLength }))).toEqual([
      { byteOffset: 0, byteLength: 1131 },
      { byteOffset: 1131, byteLength: 1104 },
    ]);
    expect(members.map((member) => member.lines.length)).toEqual([1, 1]);
    const runs = members.map((member) => JSON.parse(member.lines[0]).run);
    expect(runs).toEqual([
      { referenceTime: "2026-08-10T00:00:00Z", generatedAt: "2026-08-10T09:57:54Z" },
      { referenceTime: "2026-08-10T12:00:00Z", generatedAt: "2026-08-10T17:07:45Z" },
    ]);
  });

  it("splits the observation grammar: members first, batched lines second", () => {
    const members = splitHistoryArchive(GOES_ARCHIVE)!;
    expect(members.map((member) => member.lines.length)).toEqual([5, 3, 6, 5, 6, 3]);
    const instants = members.flatMap((member) =>
      member.lines.map((line) => JSON.parse(line) as { observedAt: string; aot: number }),
    );
    expect(instants).toHaveLength(28);
    expect(instants[0]).toEqual({ observedAt: "2026-08-10T16:00:21Z", aot: 1.753 });
    expect(instants[27]).toEqual({ observedAt: "2026-08-10T20:50:21Z", aot: 1.414 });
  });

  it("splits a Range suffix starting on a member boundary identically to the full split", () => {
    const full = splitHistoryArchive(RAQDPS_ARCHIVE)!;
    const tail = splitHistoryArchive(RAQDPS_ARCHIVE.subarray(1131))!;
    expect(tail).toHaveLength(1);
    expect(tail[0].lines).toEqual(full[1].lines);
    expect(tail[0].byteLength).toBe(full[1].byteLength);
  });

  it("returns null on corrupt bytes, never throws", () => {
    const truncatedMember = RAQDPS_ARCHIVE.subarray(0, 900);
    const trailingJunk = concat(RAQDPS_ARCHIVE, new Uint8Array([0, 1, 2]));
    const notGzip = new TextEncoder().encode("{}");
    expect(splitHistoryArchive(truncatedMember)).toBeNull();
    expect(splitHistoryArchive(trailingJunk)).toBeNull();
    expect(splitHistoryArchive(notGzip)).toBeNull();
  });

  it("splits an empty archive to no members", () => {
    expect(splitHistoryArchive(new Uint8Array(0))).toEqual([]);
  });
});

describe("parseHistoryIndexJson", () => {
  it("parses the sidecar shape", () => {
    const index = parseHistoryIndexJson(RAQDPS_INDEX)!;
    expect(index.members).toHaveLength(2);
    expect(index.members[1]).toEqual({
      byteOffset: 1131,
      byteLength: 1104,
      referenceTime: "2026-08-10T12:00:00Z",
      generatedAt: "2026-08-10T17:07:45Z",
    });
  });

  it("rejects anything that is not the sidecar shape", () => {
    expect(parseHistoryIndexJson("not json")).toBeNull();
    expect(parseHistoryIndexJson("[]")).toBeNull();
    expect(parseHistoryIndexJson('{"members":[{"byteOffset":"0"}]}')).toBeNull();
    expect(
      parseHistoryIndexJson(
        '{"members":[{"byteOffset":0,"byteLength":0,"referenceTime":"x","generatedAt":"y"}]}',
      ),
    ).toBeNull();
  });
});

describe("loadHistory", () => {
  it("loads a real month full-fetch (the launch state: no sidecar exists)", async () => {
    const { fetch, calls } = stubFetch({ [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE } });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
      }),
    );
    expect(loaded.runs.map((run) => run.run.referenceTime)).toEqual([
      "2026-08-10T00:00:00Z",
      "2026-08-10T12:00:00Z",
    ]);
    expect(loaded.runs[0].site.id).toBe("erie");
    expect(loaded.runs[0].hours).toHaveLength(72);
    expect(loaded.revisions).toEqual([]);
    expect(loaded.invalidLines).toEqual([]);
    expect(loaded.misses).toEqual({});
    expect(calls).toEqual([{ url: RAQDPS_URL }]);
  });

  it("loads profile history through the profile guard", async () => {
    const url = `${BASE}/hrdps-west/history/dundee/2026-08.jsonl.gz`;
    const { fetch } = stubFetch({ [url]: { bytes: HRDPS_WEST_ARCHIVE } });
    const loaded = hit(
      await loadForecastHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "hrdps-west",
        siteSlug: "dundee",
        months: ["2026-08"],
      }),
    );
    expect(loaded.runs.map((run) => run.run.generatedAt)).toEqual([
      "2026-08-10T10:03:32Z",
      "2026-08-10T21:07:12Z",
    ]);
    expect(loaded.runs.every((run) => run.model === "hrdps-west")).toBe(true);
    expect(loaded.runs[0].hours).toHaveLength(48);
  });

  it("dedupes a republished run keep-latest-generatedAt and states the revision", async () => {
    const lines = archiveLines(RAQDPS_ARCHIVE);
    const archive = concat(RAQDPS_ARCHIVE, republishedMember(lines[1], "2026-08-10T18:00:00Z"));
    const { fetch } = stubFetch({ [RAQDPS_URL]: { bytes: archive } });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
      }),
    );
    expect(loaded.runs.map((run) => run.run.generatedAt)).toEqual([
      "2026-08-10T09:57:54Z",
      "2026-08-10T18:00:00Z",
    ]);
    expect(loaded.revisions).toEqual([
      {
        referenceTime: "2026-08-10T12:00:00Z",
        keptGeneratedAt: "2026-08-10T18:00:00Z",
        supersededGeneratedAt: ["2026-08-10T17:07:45Z"],
      },
    ]);
  });

  it("keeps the later append on an equal-generatedAt tie and still states it", async () => {
    const lines = archiveLines(RAQDPS_ARCHIVE);
    const archive = concat(RAQDPS_ARCHIVE, new Uint8Array(gzipSync(`${lines[1]}\n`)));
    const { fetch } = stubFetch({ [RAQDPS_URL]: { bytes: archive } });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
      }),
    );
    expect(loaded.runs).toHaveLength(2);
    expect(loaded.revisions).toEqual([
      {
        referenceTime: "2026-08-10T12:00:00Z",
        keptGeneratedAt: "2026-08-10T17:07:45Z",
        supersededGeneratedAt: ["2026-08-10T17:07:45Z"],
      },
    ]);
  });

  it("dedupes across month files — the year/month-spanning dupe class", async () => {
    const lines = archiveLines(RAQDPS_ARCHIVE);
    const september = republishedMember(lines[1], "2026-09-01T00:00:00Z");
    const { fetch } = stubFetch({
      [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE },
      [`${BASE}/raqdps/history/erie/2026-09.jsonl.gz`]: { bytes: september },
    });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-09", "2026-08"],
      }),
    );
    expect(loaded.runs).toHaveLength(2);
    expect(loaded.revisions).toEqual([
      {
        referenceTime: "2026-08-10T12:00:00Z",
        keptGeneratedAt: "2026-09-01T00:00:00Z",
        supersededGeneratedAt: ["2026-08-10T17:07:45Z"],
      },
    ]);
  });

  it("Range-narrows through the sidecar index and matches the index-absent load exactly", async () => {
    const options = {
      baseUrl: BASE,
      modelSlug: "raqdps",
      siteSlug: "erie",
      months: ["2026-08"],
      since: "2026-08-10T12:00:00Z",
    } as const;

    const absent = stubFetch({ [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE } });
    const fullFetch = hit(await loadSmokeHistory({ fetch: absent.fetch, ...options }));
    expect(absent.calls).toEqual([{ url: RAQDPS_INDEX_URL }, { url: RAQDPS_URL }]);

    const present = stubFetch({
      [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE },
      [RAQDPS_INDEX_URL]: { bytes: new TextEncoder().encode(RAQDPS_INDEX) },
    });
    const ranged = hit(await loadSmokeHistory({ fetch: present.fetch, ...options }));
    expect(present.calls).toEqual([
      { url: RAQDPS_INDEX_URL },
      { url: RAQDPS_URL, range: "bytes=1131-" },
    ]);

    expect(fullFetch.runs.map((run) => run.run.referenceTime)).toEqual(["2026-08-10T12:00:00Z"]);
    expect(ranged).toEqual(fullFetch);
  });

  it("catches members a stale index has not seen — the suffix request reaches end-of-file", async () => {
    const staleIndex = JSON.stringify({
      members: [
        {
          byteOffset: 0,
          byteLength: 1131,
          referenceTime: "2026-08-10T00:00:00Z",
          generatedAt: "2026-08-10T09:57:54Z",
        },
      ],
    });
    const { fetch, calls } = stubFetch({
      [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE },
      [RAQDPS_INDEX_URL]: { bytes: new TextEncoder().encode(staleIndex) },
    });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
        since: "2026-08-10T12:00:00Z",
      }),
    );
    expect(calls[1]).toEqual({ url: RAQDPS_URL, range: "bytes=1131-" });
    expect(loaded.runs.map((run) => run.run.referenceTime)).toEqual(["2026-08-10T12:00:00Z"]);
  });

  it("reads a fresh index covering everything as nothing-new (416), not a miss", async () => {
    const { fetch } = stubFetch({
      [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE },
      [RAQDPS_INDEX_URL]: { bytes: new TextEncoder().encode(RAQDPS_INDEX) },
    });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
        since: "2026-08-11T00:00:00Z",
      }),
    );
    expect(loaded.runs).toEqual([]);
    expect(loaded.misses).toEqual({});
  });

  it("stays correct when the server ignores Range and answers 200 in full", async () => {
    const { fetch, calls } = stubFetch({
      [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE, servesRange: false },
      [RAQDPS_INDEX_URL]: { bytes: new TextEncoder().encode(RAQDPS_INDEX) },
    });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
        since: "2026-08-10T12:00:00Z",
      }),
    );
    expect(calls[1].range).toBe("bytes=1131-");
    expect(loaded.runs.map((run) => run.run.referenceTime)).toEqual(["2026-08-10T12:00:00Z"]);
  });

  it("degrades to the full fetch when the index fetch itself fails hard", async () => {
    const { fetch } = stubFetch({
      [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE },
      [RAQDPS_INDEX_URL]: { status: 500 },
    });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
        since: "2026-08-10T12:00:00Z",
      }),
    );
    expect(loaded.runs).toHaveLength(1);
  });

  it("reports a guard-rejected line loudly without poisoning the month", async () => {
    const corrupt = new Uint8Array(gzipSync('{"schemaVersion":1,"model":"raqdps"}\n'));
    const archive = concat(RAQDPS_ARCHIVE, corrupt);
    const { fetch } = stubFetch({ [RAQDPS_URL]: { bytes: archive } });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
      }),
    );
    expect(loaded.runs).toHaveLength(2);
    expect(loaded.invalidLines).toEqual([{ url: RAQDPS_URL, memberByteOffset: 2235, line: 1 }]);
  });

  it("misses a gzip-corrupt month as invalid, absent months as routine", async () => {
    const { fetch } = stubFetch({
      [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE.subarray(0, 900) },
    });
    const loaded = hit(
      await loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-07", "2026-08"],
      }),
    );
    expect(loaded.runs).toEqual([]);
    expect(loaded.misses).toEqual({
      "2026-07": { miss: "absent", url: `${BASE}/raqdps/history/erie/2026-07.jsonl.gz` },
      "2026-08": { miss: "invalid", url: RAQDPS_URL },
    });
  });

  it("returns one discriminated absent miss when every requested month is absent", async () => {
    const { fetch } = stubFetch({});
    const result = await loadSmokeHistory({
      fetch,
      baseUrl: BASE,
      modelSlug: "raqdps",
      siteSlug: "nowhere",
      months: ["2026-07", "2026-08"],
    });
    expect(result).toEqual({
      miss: "absent",
      url: `${BASE}/raqdps/history/nowhere/2026-08.jsonl.gz`,
    });
  });

  it("throws TransportHttpError on a non-404 archive failure — the only throw", async () => {
    const { fetch } = stubFetch({ [RAQDPS_URL]: { status: 503 } });
    await expect(
      loadSmokeHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
      }),
    ).rejects.toBeInstanceOf(TransportHttpError);
  });

  it("filters `since` identically on the full-fetch path (no index anywhere)", async () => {
    const { fetch } = stubFetch({ [RAQDPS_URL]: { bytes: RAQDPS_ARCHIVE } });
    const loaded = hit(
      await loadHistory({
        fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "erie",
        months: ["2026-08"],
        since: "2026-08-10T12:00:00Z",
        guard: parseSmokeDocumentJson,
      }),
    );
    expect(loaded.runs.map((run) => run.run.referenceTime)).toEqual(["2026-08-10T12:00:00Z"]);
  });
});
