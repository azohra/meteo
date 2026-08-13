import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  byteRange,
  fetchIndex,
  fetchRecord,
  findRecord,
  MissingRecordError,
  pairSpan,
  parseIdx,
} from "../src/index.js";
import type { IdxFetch, IdxRecord } from "../src/index.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures-idx/${name}`, import.meta.url)), "utf8");
}

const hrrrRecords = () => parseIdx(fixture("hrrr.t12z.wrfprsf24.excerpt.idx"));
const gfsRecords = () => parseIdx(fixture("gfs.t12z.pgrb2.0p25.f024.excerpt.idx"));
const nestRecords = () => parseIdx(fixture("nam.t12z.conusnest.hiresf24.tm00.excerpt.idx"));
const rrfsRecords = () => parseIdx(fixture("rrfs.t06z.2dfld.3km.f012.conus.excerpt.idx"));

describe("parseIdx", () => {
  it("parses idx lines into offsets and lengths", () => {
    const records = hrrrRecords();
    expect(records[0]!.variable).toBe("VVEL");
    expect(records[0]!.level).toBe("600 mb");
    expect(records[0]!.forecast).toBe("24 hour fcst");
    expect(records[0]!.offset).toBe(150408432);
    expect(records[0]!.length).toBe(records[1]!.offset - records[0]!.offset);
    expect(records[0]!.length).toBe(13631698);
  });

  it("reads the last record to end of file", () => {
    const records = hrrrRecords();
    expect(records[records.length - 1]!.length).toBeUndefined();
    expect(byteRange(records[records.length - 1]!)).toBe(
      `bytes=${records[records.length - 1]!.offset}-`,
    );
  });
});

describe("byteRange", () => {
  it("is inclusive", () => {
    expect(byteRange(hrrrRecords()[0]!)).toBe("bytes=150408432-164040129");
  });
});

describe("findRecord", () => {
  it("finds a record by variable, level, and forecast", () => {
    expect(findRecord(hrrrRecords(), "TMP", "850 mb", "24 hour fcst").offset).toBe(216778075);
  });

  it("separates instantaneous from averaged cloud cover by the forecast field", () => {
    const records = gfsRecords();
    const instantaneous = findRecord(records, "TCDC", "entire atmosphere", "24 hour fcst");
    const averaged = findRecord(records, "TCDC", "entire atmosphere", "18-24 hour ave fcst");
    expect(instantaneous.offset).not.toBe(averaged.offset);
  });

  it("separates windowed from run-total accumulations by the forecast field", () => {
    const records = gfsRecords();
    const windowed = findRecord(records, "APCP", "surface", "18-24 hour acc fcst");
    const runTotal = findRecord(records, "APCP", "surface", "0-1 day acc fcst");
    expect(windowed.offset).not.toBe(runTotal.offset);
  });

  it("raises MissingRecordError for an absent record", () => {
    expect(() => findRecord(gfsRecords(), "DPT", "850 mb", "24 hour fcst")).toThrow(
      MissingRecordError,
    );
    expect(() => findRecord(gfsRecords(), "DPT", "850 mb", "24 hour fcst")).toThrow(/DPT:850 mb/);
  });
});

describe("qualified records (RRFS-SD's speciated aerosols)", () => {
  const SMOKE = "aerosol=Particulate organic matter dry:aerosol_size <2.5e-06";
  const DUST = "aerosol=Dust dry:aerosol_size <2.5e-06";

  it("parses the tokens past the forecast field into qualifier", () => {
    const records = rrfsRecords();
    const smoke = records.find((record) => record.qualifier === SMOKE);
    expect(smoke).toBeDefined();
    expect(smoke!.variable).toBe("MASSDEN");
    // Ordinary records carry an empty qualifier, not an absent one.
    const ordinary = findRecord(records, "TMP", "2 m above ground", "12 hour fcst");
    expect(ordinary.qualifier).toBe("");
  });

  it("selects a species by qualifier where variable, level, and forecast collide", () => {
    const records = rrfsRecords();
    const smoke = findRecord(records, "MASSDEN", "8 m above ground", "12 hour fcst", SMOKE);
    const dust = findRecord(records, "MASSDEN", "8 m above ground", "12 hour fcst", DUST);
    expect(smoke.offset).not.toBe(dust.offset);
  });

  it("an empty qualifier demands an unqualified record", () => {
    const records = rrfsRecords();
    // AOTK is published unqualified — the empty qualifier finds it.
    findRecord(
      records,
      "AOTK",
      "entire atmosphere (considered as a single layer)",
      "12 hour fcst",
      "",
    );
    // Every MASSDEN record is speciated, so demanding an unqualified one fails.
    expect(() => findRecord(records, "MASSDEN", "8 m above ground", "12 hour fcst", "")).toThrow(
      MissingRecordError,
    );
  });

  it("omitting the qualifier keeps the first-match behaviour", () => {
    const records = rrfsRecords();
    const first = findRecord(records, "MASSDEN", "8 m above ground", "12 hour fcst");
    const bySpecies = findRecord(records, "MASSDEN", "8 m above ground", "12 hour fcst", SMOKE);
    expect(first.offset).toBe(bySpecies.offset); // smoke happens to be listed first
  });
});

describe("pairSpan (NCEP N.1/N.2 paired submessages)", () => {
  it("gives the shared-offset pair a zero-length first and a spanning second", () => {
    const records = nestRecords();
    const u = findRecord(records, "UGRD", "850 mb", "24 hour fcst");
    const v = findRecord(records, "VGRD", "850 mb", "24 hour fcst");
    const absv = findRecord(records, "ABSV", "850 mb", "24 hour fcst");
    expect(u.offset).toBe(v.offset);
    expect(u.length).toBe(0);
    expect(v.length).toBe(absv.offset - v.offset);

    const span = pairSpan(u, v);
    expect(span.offset).toBe(u.offset);
    expect(span.length).toBe(absv.offset - u.offset);
  });

  it("handles an end-of-file pair", () => {
    const u: IdxRecord = {
      variable: "UGRD",
      level: "10 m above ground",
      forecast: "24 hour fcst",
      offset: 100,
      length: 0,
    };
    const v: IdxRecord = {
      variable: "VGRD",
      level: "10 m above ground",
      forecast: "24 hour fcst",
      offset: 100,
      length: undefined,
    };
    expect(pairSpan(u, v)).toBe(v);
    expect(pairSpan(v, u)).toBe(v);
  });
});

function stubFetch(
  status: number,
  body: Uint8Array | string,
): IdxFetch & { calls: Array<{ url: string; range?: string }> } {
  const calls: Array<{ url: string; range?: string }> = [];
  const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, range: init?.headers?.Range });
    return {
      status,
      text: async () => (typeof body === "string" ? body : new TextDecoder().decode(body)),
      arrayBuffer: async () => {
        const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      },
    };
  };
  return Object.assign(fetchImpl, { calls });
}

describe("fetchRecord", () => {
  const record: IdxRecord = {
    variable: "TMP",
    level: "850 mb",
    forecast: "6 hour fcst",
    offset: 10,
    length: 4,
  };

  it("sends the record's inclusive Range and accepts 206", async () => {
    const stub = stubFetch(206, new Uint8Array([1, 2, 3, 4]));
    const bytes = await fetchRecord(stub, "https://example.test/file.grib2", record);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
    expect(stub.calls[0]!.range).toBe("bytes=10-13");
  });

  it("a 200 answering a Range request fails rather than masquerading as a ranged read", async () => {
    const stub = stubFetch(200, new Uint8Array([1, 2, 3, 4]));
    await expect(fetchRecord(stub, "https://example.test/file.grib2", record)).rejects.toThrow(
      /answered 200 to a Range request/,
    );
  });

  it("sends an open range for an end-of-file record", async () => {
    const stub = stubFetch(206, new Uint8Array([9]));
    await fetchRecord(stub, "https://example.test/f", { ...record, length: undefined });
    expect(stub.calls[0]!.range).toBe("bytes=10-");
  });
});

describe("fetchIndex", () => {
  it("parses a 200 body", async () => {
    const stub = stubFetch(
      200,
      "1:0:d=2026081200:TMP:850 mb:6 hour fcst:\n2:100:d=2026081200:UGRD:850 mb:6 hour fcst:\n",
    );
    const records = await fetchIndex(stub, "https://example.test/file.grib2.idx");
    expect(records).toHaveLength(2);
    expect(records[0]!.length).toBe(100);
    expect(records[1]!.length).toBeUndefined();
  });

  it("fails on any non-200 status", async () => {
    const stub = stubFetch(404, "");
    await expect(fetchIndex(stub, "https://example.test/missing.idx")).rejects.toThrow(/404/);
  });
});
