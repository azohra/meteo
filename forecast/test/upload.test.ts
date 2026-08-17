import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PublisherConfigurationError } from "../src/config.js";
import { openMonths, publishModel, publishPlan } from "../src/upload.js";
import type { TransportFetch, TransportInit } from "../src/providers/transport.js";
import { noSleep, useCleanWireEnv } from "./helpers/wire.js";

useCleanWireEnv();

const ENDPOINT = "https://account.r2.cloudflarestorage.com";
const BUCKET = "meteo-data";
const NOW = () => new Date("2026-08-16T12:00:00Z");

function s3Env(): void {
  delete process.env["METEO_DATA_BASE"];
  process.env["R2_ENDPOINT"] = ENDPOINT;
  process.env["AWS_ACCESS_KEY_ID"] = "key";
  process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
  process.env["METEO_R2_BUCKET"] = BUCKET;
}

function xmlError(code: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>scripted</Message></Error>`;
}

/* A scratch tree as one build leaves it: one closed month, one open month,
   a site document, and the manifest. */
function scratchTree(model: string): string {
  const root = mkdtempSync(join(tmpdir(), "meteo-upload-test-"));
  const history = join(root, model, "history", "dundee");
  mkdirSync(history, { recursive: true });
  for (const month of ["2026-06", "2026-08"]) {
    writeFileSync(join(history, `${month}.jsonl.gz`), `gz:${month}`);
    writeFileSync(join(history, `${month}.index.json`), `{"month":"${month}"}`);
  }
  const sites = join(root, model, "sites");
  mkdirSync(sites, { recursive: true });
  writeFileSync(join(sites, "dundee.json"), `{"site":"dundee"}`);
  writeFileSync(
    join(root, model, "manifest.json"),
    JSON.stringify({
      model,
      referenceTime: "2026-08-16T06:00:00Z",
      generatedAt: "2026-08-16T09:12:00Z",
    }),
  );
  return root;
}

interface SeenRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
}

/* URL-aware wire: GETs answer by script, PUTs succeed unless told otherwise. */
function s3Wire({
  manifestGet = { status: 404, body: xmlError("NoSuchKey") },
  putStatus = 200,
  putBody = "",
}: {
  manifestGet?: { status: number; body: string };
  putStatus?: number;
  putBody?: string;
} = {}): { fetch: TransportFetch; seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  const fetch: TransportFetch = async (url: string, init?: TransportInit) => {
    const method = init?.method ?? "GET";
    seen.push({
      method,
      path: decodeURIComponent(new URL(url).pathname),
      headers: init?.headers ?? {},
    });
    const answer =
      method === "PUT"
        ? { status: putStatus, body: putBody }
        : { status: manifestGet.status, body: manifestGet.body };
    const bytes = new TextEncoder().encode(answer.body);
    return {
      status: answer.status,
      headers: new Headers(),
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    };
  };
  return { fetch, seen };
}

describe("openMonths", () => {
  it("keeps the current and previous month open — a run straddling the boundary appends backwards", () => {
    expect(openMonths(new Date("2026-08-01T00:10:00Z"))).toEqual({
      current: "2026-08",
      previous: "2026-07",
    });
    expect(openMonths(new Date("2026-01-15T00:00:00Z"))).toEqual({
      current: "2026-01",
      previous: "2025-12",
    });
  });
});

describe("publishPlan", () => {
  it("orders open archives, open indexes, closed archives, closed indexes, sites, manifest last", () => {
    const root = scratchTree("gfs");
    const plan = publishPlan("gfs", root, NOW());
    expect(plan.map((upload) => upload.key)).toEqual([
      "gfs/history/dundee/2026-08.jsonl.gz",
      "gfs/history/dundee/2026-08.index.json",
      "gfs/history/dundee/2026-06.jsonl.gz",
      "gfs/history/dundee/2026-06.index.json",
      "gfs/sites/dundee.json",
      "gfs/manifest.json",
    ]);
    const byKey = new Map(plan.map((upload) => [upload.key, upload]));
    expect(byKey.get("gfs/history/dundee/2026-08.jsonl.gz")).toMatchObject({
      cacheControl: "public, max-age=300",
      contentType: "application/gzip",
    });
    expect(byKey.get("gfs/history/dundee/2026-06.jsonl.gz")).toMatchObject({
      cacheControl: "public, max-age=31536000, immutable",
    });
    // The one file whose job is to say what the archive holds right now
    // must never ride the immutable TTL while its month is open.
    expect(byKey.get("gfs/history/dundee/2026-08.index.json")).toMatchObject({
      cacheControl: "public, max-age=300",
      contentType: "application/json",
    });
    expect(byKey.get("gfs/history/dundee/2026-06.index.json")).toMatchObject({
      cacheControl: "public, max-age=31536000, immutable",
    });
    expect(byKey.get("gfs/manifest.json")).toMatchObject({
      cacheControl: "public, max-age=300",
      contentType: "application/json",
    });
  });

  it("cache lifetimes are the caller's — the TRIAL defaults move without touching the plan", () => {
    const root = scratchTree("gfs");
    const plan = publishPlan("gfs", root, NOW(), {
      live: "public, max-age=60",
      closedMonths: "public, max-age=604800",
    });
    const byKey = new Map(plan.map((upload) => [upload.key, upload]));
    expect(byKey.get("gfs/manifest.json")?.cacheControl).toBe("public, max-age=60");
    expect(byKey.get("gfs/history/dundee/2026-06.jsonl.gz")?.cacheControl).toBe(
      "public, max-age=604800",
    );
  });

  it("tolerates a model without history (observation trees)", () => {
    const root = mkdtempSync(join(tmpdir(), "meteo-upload-test-"));
    mkdirSync(join(root, "goes18-dsr", "sites"), { recursive: true });
    writeFileSync(join(root, "goes18-dsr", "sites", "dundee.json"), "{}");
    writeFileSync(join(root, "goes18-dsr", "manifest.json"), "{}");
    expect(publishPlan("goes18-dsr", root, NOW()).map((upload) => upload.key)).toEqual([
      "goes18-dsr/sites/dundee.json",
      "goes18-dsr/manifest.json",
    ]);
  });
});

describe("publishModel", () => {
  it("uploads the plan in order and advances runs.json last", async () => {
    s3Env();
    const root = scratchTree("gfs");
    const wire = s3Wire();
    const result = await publishModel("gfs", {
      dataRoot: root,
      now: NOW,
      fetch: wire.fetch,
      sleep: noSleep,
    });
    expect(result).toEqual({ verdict: "published", objects: 7 });
    const puts = wire.seen.filter((request) => request.method === "PUT");
    expect(puts.map((request) => request.path)).toEqual([
      `/${BUCKET}/gfs/history/dundee/2026-08.jsonl.gz`,
      `/${BUCKET}/gfs/history/dundee/2026-08.index.json`,
      `/${BUCKET}/gfs/history/dundee/2026-06.jsonl.gz`,
      `/${BUCKET}/gfs/history/dundee/2026-06.index.json`,
      `/${BUCKET}/gfs/sites/dundee.json`,
      `/${BUCKET}/gfs/manifest.json`,
      `/${BUCKET}/runs.json`,
    ]);
    expect(puts[0].headers["cache-control"]).toBe("public, max-age=300");
    expect(puts[2].headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(puts[0].headers["content-type"]).toBe("application/gzip");
    expect(puts[6].headers["content-type"]).toBe("application/json");
    // The freshness read precedes every upload: never publish blind.
    expect(wire.seen[0]).toMatchObject({ method: "GET", path: `/${BUCKET}/gfs/manifest.json` });
  });

  it("reports nothing to do when the builder wrote no manifest", async () => {
    s3Env();
    const root = mkdtempSync(join(tmpdir(), "meteo-upload-test-"));
    const wire = s3Wire();
    expect(await publishModel("gfs", { dataRoot: root, now: NOW, fetch: wire.fetch })).toEqual({
      verdict: "nothing",
    });
    expect(wire.seen).toHaveLength(0);
  });

  it("never publishes backwards: a published manifest at least as new skips the upload", async () => {
    s3Env();
    const root = scratchTree("gfs");
    const wire = s3Wire({
      manifestGet: {
        status: 200,
        body: JSON.stringify({
          model: "gfs",
          referenceTime: "2026-08-16T06:00:00Z",
          generatedAt: "2026-08-16T09:12:00Z",
        }),
      },
    });
    expect(
      await publishModel("gfs", { dataRoot: root, now: NOW, fetch: wire.fetch, sleep: noSleep }),
    ).toEqual({ verdict: "stale" });
    expect(wire.seen.filter((request) => request.method === "PUT")).toHaveLength(0);
  });

  it("an unreachable bucket throws — it must never read as a freshness verdict", async () => {
    s3Env();
    const root = scratchTree("gfs");
    const failing: TransportFetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    await expect(
      publishModel("gfs", { dataRoot: root, now: NOW, fetch: failing, sleep: noSleep }),
    ).rejects.toThrowError(/ECONNREFUSED/);
  });

  it("a denied PUT throws with the S3 code instead of retrying forever", async () => {
    s3Env();
    const root = scratchTree("gfs");
    const wire = s3Wire({ putStatus: 403, putBody: xmlError("AccessDenied") });
    await expect(
      publishModel("gfs", { dataRoot: root, now: NOW, fetch: wire.fetch, sleep: noSleep }),
    ).rejects.toThrowError(/AccessDenied/);
  });

  it("refuses to publish without the authenticated endpoint", async () => {
    // useCleanWireEnv leaves METEO_DATA_BASE set: read-only configuration.
    await expect(publishModel("gfs", { now: NOW })).rejects.toThrowError(
      PublisherConfigurationError,
    );
  });
});
