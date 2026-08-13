import { describe, expect, it } from "vitest";
import { PublisherConfigurationError } from "../src/config.js";
import {
  dataBase,
  fetchPublished,
  prefetchedManifestReader,
  publishedHistory,
  publishedManifest,
  publishedReferenceTime,
  s3Mode,
} from "../src/dataset.js";
import { runsIndex } from "../src/publish.js";
import {
  TEST_DATA_BASE,
  noSleep,
  stubFetch,
  useCleanWireEnv,
  type StubbedWire,
} from "./helpers/wire.js";

useCleanWireEnv();

describe("dataBase", () => {
  it("is required configuration — no default deployment, the fix named", () => {
    delete process.env["METEO_DATA_BASE"];
    expect(() => dataBase()).toThrowError(PublisherConfigurationError);
    expect(() => dataBase()).toThrowError(/METEO_DATA_BASE/);
    expect(() => dataBase()).toThrowError(/METEO_R2_BUCKET/);
  });

  it("an unconfigured read fails loudly instead of inventing a base", async () => {
    delete process.env["METEO_DATA_BASE"];
    const wire = stubFetch([]);
    await expect(fetchPublished("gfs/manifest.json", { fetch: wire.fetch })).rejects.toThrowError(
      /METEO_DATA_BASE/,
    );
    expect(wire.requests).toHaveLength(0);
  });

  it("reads the override per call, trailing slash stripped", () => {
    process.env["METEO_DATA_BASE"] = "https://club.example.com/forecasts/";
    expect(dataBase()).toBe("https://club.example.com/forecasts");
  });
});

describe("fetchPublished over public HTTPS", () => {
  it("fetches from the configured base", async () => {
    process.env["METEO_DATA_BASE"] = "https://club.example.com";
    const wire = stubFetch([{ status: 200, body: "payload" }]);

    const payload = await fetchPublished("gfs/manifest.json", { fetch: wire.fetch });

    expect(new TextDecoder().decode(payload!)).toBe("payload");
    expect(wire.requests.map((request) => request.url)).toEqual([
      "https://club.example.com/gfs/manifest.json",
    ]);
  });

  it("a 404 means not yet published and is never retried", async () => {
    const wire = stubFetch([{ status: 404 }]);
    expect(await fetchPublished("gfs/manifest.json", { fetch: wire.fetch })).toBeNull();
    expect(wire.requests).toHaveLength(1);
  });

  it("a 403 means not yet published, like a 404", async () => {
    const wire = stubFetch([{ status: 403 }]);
    expect(await fetchPublished("goes18-dsr/manifest.json", { fetch: wire.fetch })).toBeNull();
    expect(wire.requests).toHaveLength(1);
  });

  it("a Cloudflare challenge 403 is fatal, never absence", async () => {
    const wire = stubFetch([{ status: 403, headers: { "cf-mitigated": "challenge" } }]);
    await expect(
      fetchPublished("hrdps-west/manifest.json", { fetch: wire.fetch }),
    ).rejects.toThrowError(/Cloudflare bot challenge/);
    expect(wire.requests).toHaveLength(1);
  });

  it("other client errors stay fatal", async () => {
    const wire = stubFetch([{ status: 401 }]);
    await expect(fetchPublished("gfs/manifest.json", { fetch: wire.fetch })).rejects.toThrowError(
      /failed with 401/,
    );
  });

  it("server errors are retried before failing", async () => {
    const wire = stubFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    await expect(
      fetchPublished("gfs/manifest.json", { fetch: wire.fetch, sleep: noSleep }),
    ).rejects.toThrowError(/failed with 500/);
    expect(wire.requests).toHaveLength(3);
  });

  it("a retry can recover", async () => {
    const wire = stubFetch([{ status: 503 }, { status: 200, body: "recovered" }]);
    const payload = await fetchPublished("runs.json", { fetch: wire.fetch, sleep: noSleep });
    expect(new TextDecoder().decode(payload!)).toBe("recovered");
  });

  it("transport errors are retried too", async () => {
    const wire = stubFetch([new Error("socket reset"), { status: 200, body: "ok" }]);
    const payload = await fetchPublished("runs.json", { fetch: wire.fetch, sleep: noSleep });
    expect(new TextDecoder().decode(payload!)).toBe("ok");
    expect(wire.requests).toHaveLength(2);
  });
});

describe("the published readers", () => {
  const MANIFEST = {
    model: "gfs",
    referenceTime: "2026-08-09T06:00:00Z",
    generatedAt: "2026-08-09T09:12:00Z",
  };

  it("publishedManifest parses JSON and reports absence", async () => {
    const published = stubFetch([{ status: 200, body: JSON.stringify(MANIFEST) }]);
    expect(await publishedManifest("gfs", { fetch: published.fetch })).toEqual(MANIFEST);

    const absent = stubFetch([{ status: 404 }]);
    expect(await publishedManifest("gfs", { fetch: absent.fetch })).toBeNull();
  });

  it("publishedReferenceTime is null before a first run", async () => {
    const absent = stubFetch([{ status: 404 }]);
    expect(await publishedReferenceTime("gfs", { fetch: absent.fetch })).toBeNull();

    const published = stubFetch([{ status: 200, body: JSON.stringify(MANIFEST) }]);
    expect(await publishedReferenceTime("gfs", { fetch: published.fetch })).toBe(
      "2026-08-09T06:00:00Z",
    );
  });

  it("publishedHistory is empty for a new month", async () => {
    const wire = stubFetch([{ status: 404 }]);
    const bytes = await publishedHistory("gfs", "dundee", "2026-08", { fetch: wire.fetch });
    expect(bytes).toEqual(new Uint8Array(0));
    expect(wire.requests.map((request) => request.url)).toEqual([
      `${TEST_DATA_BASE}/gfs/history/dundee/2026-08.jsonl.gz`,
    ]);
  });

  it("prefetchedManifestReader plugs the network into the sync runs-index seam", async () => {
    const wire = stubFetch([{ status: 200, body: JSON.stringify(MANIFEST) }, { status: 404 }]);

    const reader = await prefetchedManifestReader(["gfs", "geps"], { fetch: wire.fetch });

    expect(reader("gfs")).toEqual(MANIFEST);
    expect(reader("geps")).toBeNull();
    expect(runsIndex(["gfs", "geps"], reader)).toEqual({
      schemaVersion: 1,
      runs: {
        gfs: { referenceTime: "2026-08-09T06:00:00Z", generatedAt: "2026-08-09T09:12:00Z" },
      },
    });
  });
});

const ENDPOINT = "https://account.r2.cloudflarestorage.com";

function s3Env(): void {
  delete process.env["METEO_DATA_BASE"];
  process.env["R2_ENDPOINT"] = ENDPOINT;
  process.env["AWS_ACCESS_KEY_ID"] = "key";
  process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
  process.env["METEO_R2_BUCKET"] = "meteo-data";
}

function xmlError(code: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>scripted</Message></Error>`;
}

function authorizationOf(wire: StubbedWire, index = 0): string | undefined {
  return wire.requests[index]?.init?.headers?.["authorization"];
}

describe("fetchPublished through the authenticated S3 API", () => {
  it("reads the bucket with a SigV4-signed GET and returns the bytes", async () => {
    s3Env();
    const wire = stubFetch([{ status: 200, body: "payload" }]);

    const payload = await fetchPublished("gfs/manifest.json", { fetch: wire.fetch });

    expect(new TextDecoder().decode(payload!)).toBe("payload");
    expect(wire.requests.map((request) => request.url)).toEqual([
      `${ENDPOINT}/meteo-data/gfs/manifest.json`,
    ]);
    expect(authorizationOf(wire)).toMatch(/^AWS4-HMAC-SHA256 Credential=key\//);
  });

  it("honours the bucket override", async () => {
    s3Env();
    process.env["METEO_R2_BUCKET"] = "meteo-data-staging";
    const wire = stubFetch([{ status: 200, body: "{}" }]);

    await fetchPublished("runs.json", { fetch: wire.fetch });

    expect(wire.requests.map((request) => request.url)).toEqual([
      `${ENDPOINT}/meteo-data-staging/runs.json`,
    ]);
  });

  it("requires the bucket — no default name, the fix named", async () => {
    s3Env();
    delete process.env["METEO_R2_BUCKET"];
    expect(s3Mode()).toBe(true);
    const wire = stubFetch([]);
    await expect(fetchPublished("runs.json", { fetch: wire.fetch })).rejects.toThrowError(
      /METEO_R2_BUCKET/,
    );
    expect(wire.requests).toHaveLength(0);
  });

  it("NoSuchKey is true absence", async () => {
    s3Env();
    const wire = stubFetch([{ status: 404, body: xmlError("NoSuchKey") }]);

    expect(await fetchPublished("goes18-dsr/manifest.json", { fetch: wire.fetch })).toBeNull();
    expect(wire.requests).toHaveLength(1);
  });

  it("AccessDenied is fatal, never absence", async () => {
    s3Env();
    const wire = stubFetch([{ status: 403, body: xmlError("AccessDenied") }]);

    await expect(fetchPublished("gfs/manifest.json", { fetch: wire.fetch })).rejects.toThrowError(
      /AccessDenied.*misconfigured/s,
    );
    expect(wire.requests).toHaveLength(1);
  });

  it("throttling is retried and can recover", async () => {
    s3Env();
    const wire = stubFetch([
      { status: 503, body: xmlError("SlowDown") },
      { status: 200, body: "recovered" },
    ]);

    const payload = await fetchPublished("runs.json", { fetch: wire.fetch, sleep: noSleep });

    expect(new TextDecoder().decode(payload!)).toBe("recovered");
    expect(wire.requests).toHaveLength(2);
  });

  it("server errors exhaust the retry budget then fail", async () => {
    s3Env();
    const wire = stubFetch(
      Array.from({ length: 3 }, () => ({ status: 500, body: xmlError("InternalError") })),
    );

    await expect(
      fetchPublished("gfs/manifest.json", { fetch: wire.fetch, sleep: noSleep }),
    ).rejects.toThrowError(/InternalError/);
    expect(wire.requests).toHaveLength(3);
  });

  it("other client errors stay fatal", async () => {
    s3Env();
    const wire = stubFetch([{ status: 404, body: xmlError("NoSuchBucket") }]);

    await expect(fetchPublished("gfs/manifest.json", { fetch: wire.fetch })).rejects.toThrowError(
      /NoSuchBucket/,
    );
  });
});

describe("the transport selection matrix", () => {
  it("S3 mode engages only with the full credential set", () => {
    expect(s3Mode()).toBe(false);

    s3Env();
    expect(s3Mode()).toBe(true);

    delete process.env["AWS_SECRET_ACCESS_KEY"];
    expect(s3Mode()).toBe(false);
  });

  it("an explicit data base always wins over credentials", async () => {
    s3Env();
    process.env["METEO_DATA_BASE"] = "https://club.example.com";
    expect(s3Mode()).toBe(false);

    const wire = stubFetch([{ status: 200, body: "payload" }]);
    const payload = await fetchPublished("gfs/manifest.json", { fetch: wire.fetch });

    expect(new TextDecoder().decode(payload!)).toBe("payload");
    expect(wire.requests.map((request) => request.url)).toEqual([
      "https://club.example.com/gfs/manifest.json",
    ]);
    expect(authorizationOf(wire)).toBeUndefined();
  });
});
