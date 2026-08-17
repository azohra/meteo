import { describe, expect, it } from "vitest";
import type {
  ObservationDocument,
  SmokeDocument,
  ForecastManifest,
  SiteForecast,
} from "../src/contract.js";
import { parseSmokeDocumentJson, parseSiteForecastJson } from "../src/contract.js";
import {
  documentPaths,
  loadObservation,
  loadForecast,
  loadRuns,
  loadSiteSet,
  loadSmoke,
  runsConsistent,
  TransportHttpError,
  type DocumentMiss,
  type TransportResponse,
} from "../src/transport.js";
import { deterministicProfile, manifest, runsIndex } from "./fixtures.js";

function hit<T extends object>(result: T | DocumentMiss): T {
  if ("miss" in result) throw new Error(`unexpected miss: ${JSON.stringify(result)}`);
  return result;
}

const BASE = "https://example.test/data";
const MANIFEST_URL = `${BASE}/hrdps-continental/manifest.json`;
const PROFILE_URL = `${BASE}/hrdps-continental/sites/dundee.json`;

function ok(body: unknown): TransportResponse {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}

function status(code: number): TransportResponse {
  return { ok: false, status: code, text: async () => "" };
}

function stubFetch(script: Record<string, TransportResponse[]>) {
  const calls: string[] = [];
  const served = new Map<string, number>();
  const fetch = async (url: string): Promise<TransportResponse> => {
    calls.push(url);
    const queue = script[url];
    if (!queue || queue.length === 0) return status(404);
    const index = Math.min(served.get(url) ?? 0, queue.length - 1);
    served.set(url, index + 1);
    return queue[index];
  };
  return { fetch, calls };
}

function pair(referenceTime: string): { manifest: ForecastManifest; profile: SiteForecast } {
  const taggedManifest = { ...manifest(), referenceTime };
  const profile = deterministicProfile();
  const taggedProfile = { ...profile, run: { ...profile.run, referenceTime } };
  return { manifest: taggedManifest, profile: taggedProfile };
}

const noWait = { delayMs: 0, sleep: async () => {} };

describe("documentPaths", () => {
  it("matches the URLs the loaders built from literals before it existed, byte for byte", () => {
    // Per-model tree — the shapes loadDocument/loadObservation/loadSiteSet
    // fetched as `${base}/${modelSlug}/…` literals.
    expect(`${BASE}/${documentPaths.manifest("hrdps-continental")}`).toBe(MANIFEST_URL);
    expect(`${BASE}/${documentPaths.siteDocument("hrdps-continental", "dundee")}`).toBe(
      PROFILE_URL,
    );
    // History tree — the shapes history/'s loadHistory fetched.
    expect(documentPaths.history("raqdps", "erie", "2026-08")).toBe(
      "raqdps/history/erie/2026-08.jsonl.gz",
    );
    expect(documentPaths.historyIndex("raqdps", "erie", "2026-08")).toBe(
      "raqdps/history/erie/2026-08.index.json",
    );
    // Dataset root — runs.json as loadRuns fetched it, plus the three
    // root catalogues the read side expects beside it.
    expect(`${BASE}/${documentPaths.runs()}`).toBe(`${BASE}/runs.json`);
    expect(documentPaths.models()).toBe("models.json");
    expect(documentPaths.sites()).toBe("sites.json");
    expect(documentPaths.siteContext()).toBe("site-context.json");
  });
});

describe("runsConsistent", () => {
  it("is true exactly when model and referenceTime agree", () => {
    const { manifest: m, profile: p } = pair("2026-08-08T00:00:00Z");
    expect(runsConsistent(m, p)).toBe(true);
    expect(runsConsistent({ ...m, referenceTime: "2026-08-08T06:00:00Z" }, p)).toBe(false);
    expect(runsConsistent({ ...m, model: "gfs" }, p)).toBe(false);
  });
});

describe("loadForecast", () => {
  it("returns a consistent pair first try without retrying", async () => {
    const run = pair("2026-08-08T00:00:00Z");
    const { fetch, calls } = stubFetch({
      [MANIFEST_URL]: [ok(run.manifest)],
      [PROFILE_URL]: [ok(run.profile)],
    });
    const loaded = await loadForecast({
      fetch,
      baseUrl: BASE,
      modelSlug: "hrdps-continental",
      siteSlug: "dundee",
    });
    const pairLoaded = hit(loaded);
    expect(pairLoaded.stale).toBe(false);
    expect(pairLoaded.manifest.referenceTime).toBe("2026-08-08T00:00:00Z");
    expect(calls).toHaveLength(2);
  });

  it("recovers from a torn read when the retry converges", async () => {
    const oldRun = pair("2026-08-08T00:00:00Z");
    const newRun = pair("2026-08-08T06:00:00Z");
    const { fetch, calls } = stubFetch({
      [MANIFEST_URL]: [ok(newRun.manifest), ok(newRun.manifest)],
      [PROFILE_URL]: [ok(oldRun.profile), ok(newRun.profile)],
    });
    const loaded = await loadForecast({
      fetch,
      baseUrl: BASE,
      modelSlug: "hrdps-continental",
      siteSlug: "dundee",
      retry: noWait,
    });
    const pairLoaded = hit(loaded);
    expect(pairLoaded.stale).toBe(false);
    expect(pairLoaded.profile.run.referenceTime).toBe("2026-08-08T06:00:00Z");
    expect(calls).toHaveLength(4);
  });

  it("reports stale honestly when the tear outlives the single retry", async () => {
    const oldRun = pair("2026-08-08T00:00:00Z");
    const newRun = pair("2026-08-08T06:00:00Z");
    const { fetch, calls } = stubFetch({
      [MANIFEST_URL]: [ok(newRun.manifest)],
      [PROFILE_URL]: [ok(oldRun.profile)],
    });
    const loaded = await loadForecast({
      fetch,
      baseUrl: BASE,
      modelSlug: "hrdps-continental",
      siteSlug: "dundee",
      retry: noWait,
    });
    const pairLoaded = hit(loaded);
    expect(pairLoaded.stale).toBe(true);
    expect(pairLoaded.manifest.referenceTime).toBe("2026-08-08T06:00:00Z");
    expect(pairLoaded.profile.run.referenceTime).toBe("2026-08-08T00:00:00Z");
    expect(calls).toHaveLength(4);
  });

  it("falls back to the first complete pair when the retry loses a document", async () => {
    const oldRun = pair("2026-08-08T00:00:00Z");
    const newRun = pair("2026-08-08T06:00:00Z");
    const { fetch } = stubFetch({
      [MANIFEST_URL]: [ok(newRun.manifest), ok(newRun.manifest)],
      [PROFILE_URL]: [ok(oldRun.profile), status(404)],
    });
    const loaded = await loadForecast({
      fetch,
      baseUrl: BASE,
      modelSlug: "hrdps-continental",
      siteSlug: "dundee",
      retry: noWait,
    });
    const pairLoaded = hit(loaded);
    expect(pairLoaded.stale).toBe(true);
    expect(pairLoaded.profile.run.referenceTime).toBe("2026-08-08T00:00:00Z");
  });

  it("waits the configured delay (and only on a torn read)", async () => {
    const oldRun = pair("2026-08-08T00:00:00Z");
    const newRun = pair("2026-08-08T06:00:00Z");
    const waits: number[] = [];
    const { fetch } = stubFetch({
      [MANIFEST_URL]: [ok(newRun.manifest), ok(newRun.manifest)],
      [PROFILE_URL]: [ok(oldRun.profile), ok(newRun.profile)],
    });
    await loadForecast({
      fetch,
      baseUrl: BASE,
      modelSlug: "hrdps-continental",
      siteSlug: "dundee",
      retry: {
        delayMs: 250,
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
    });
    expect(waits).toEqual([250]);
  });

  it("reports a 404 as an 'absent' miss naming the missing document", async () => {
    const run = pair("2026-08-08T00:00:00Z");
    const noManifest = stubFetch({ [PROFILE_URL]: [ok(run.profile)] });
    expect(
      await loadForecast({
        fetch: noManifest.fetch,
        baseUrl: BASE,
        modelSlug: "hrdps-continental",
        siteSlug: "dundee",
      }),
    ).toEqual({ miss: "absent", url: MANIFEST_URL });
    const noProfile = stubFetch({ [MANIFEST_URL]: [ok(run.manifest)] });
    expect(
      await loadForecast({
        fetch: noProfile.fetch,
        baseUrl: BASE,
        modelSlug: "hrdps-continental",
        siteSlug: "dundee",
      }),
    ).toEqual({ miss: "absent", url: PROFILE_URL });
  });

  it("reports a guard failure as an 'invalid' miss — a contract break must not hide as a 404", async () => {
    const run = pair("2026-08-08T00:00:00Z");
    const { fetch } = stubFetch({
      [MANIFEST_URL]: [ok(run.manifest)],
      [PROFILE_URL]: [ok({ prototype: true })],
    });
    expect(
      await loadForecast({
        fetch,
        baseUrl: BASE,
        modelSlug: "hrdps-continental",
        siteSlug: "dundee",
      }),
    ).toEqual({ miss: "invalid", url: PROFILE_URL });
  });

  it("throws TransportHttpError on non-404 failures instead of masking them", async () => {
    const run = pair("2026-08-08T00:00:00Z");
    const { fetch } = stubFetch({
      [MANIFEST_URL]: [status(503)],
      [PROFILE_URL]: [ok(run.profile)],
    });
    await expect(
      loadForecast({ fetch, baseUrl: BASE, modelSlug: "hrdps-continental", siteSlug: "dundee" }),
    ).rejects.toThrow(TransportHttpError);
  });

  it("tolerates a trailing slash on baseUrl", async () => {
    const run = pair("2026-08-08T00:00:00Z");
    const { fetch, calls } = stubFetch({
      [MANIFEST_URL]: [ok(run.manifest)],
      [PROFILE_URL]: [ok(run.profile)],
    });
    const loaded = await loadForecast({
      fetch,
      baseUrl: `${BASE}/`,
      modelSlug: "hrdps-continental",
      siteSlug: "dundee",
    });
    expect(loaded).not.toBeNull();
    expect(calls).toContain(MANIFEST_URL);
  });
});

const SMOKE_MANIFEST_URL = `${BASE}/raqdps/manifest.json`;
const SMOKE_URL = `${BASE}/raqdps/sites/dundee.json`;

function smokePair(referenceTime: string): {
  manifest: ForecastManifest;
  smoke: SmokeDocument;
} {
  return {
    manifest: { ...manifest(), model: "raqdps", referenceTime },
    smoke: {
      schemaVersion: 1,
      model: "raqdps",
      run: { referenceTime, generatedAt: "2026-08-08T04:47:14Z" },
      site: { id: "dundee", name: "Dundee", latitude: 49.291977, longitude: -117.183569 },
      hours: [
        {
          validAt: "2026-08-08T18:00:00Z",
          pm25Ugm3: 40,
          smokePlumeSurfaceUgm3: 37.5,
          smokePlumeColumnMgm2: 200,
        },
      ],
    },
  };
}

describe("loadSmoke", () => {
  it("runs the same skew dance as loadForecast: a torn pair reads stale, a converging retry heals", async () => {
    const oldRun = smokePair("2026-08-08T00:00:00Z");
    const newRun = smokePair("2026-08-08T12:00:00Z");

    const torn = stubFetch({
      [SMOKE_MANIFEST_URL]: [ok(newRun.manifest)],
      [SMOKE_URL]: [ok(oldRun.smoke)],
    });
    const stale = hit(
      await loadSmoke({
        fetch: torn.fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "dundee",
        retry: noWait,
      }),
    );
    expect(stale.stale).toBe(true);
    expect(stale.manifest.referenceTime).toBe("2026-08-08T12:00:00Z");
    expect(stale.smoke.run.referenceTime).toBe("2026-08-08T00:00:00Z");
    expect(torn.calls).toHaveLength(4);

    const healing = stubFetch({
      [SMOKE_MANIFEST_URL]: [ok(newRun.manifest), ok(newRun.manifest)],
      [SMOKE_URL]: [ok(oldRun.smoke), ok(newRun.smoke)],
    });
    const healed = hit(
      await loadSmoke({
        fetch: healing.fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "dundee",
        retry: noWait,
      }),
    );
    expect(healed.stale).toBe(false);
    expect(healed.smoke.run.referenceTime).toBe("2026-08-08T12:00:00Z");
  });

  it("rejects a document that fails the smoke guard as an 'invalid' miss", async () => {
    const run = smokePair("2026-08-08T00:00:00Z");
    const { fetch } = stubFetch({
      [SMOKE_MANIFEST_URL]: [ok(run.manifest)],
      [SMOKE_URL]: [ok(deterministicProfile())],
    });
    expect(
      await loadSmoke({ fetch, baseUrl: BASE, modelSlug: "raqdps", siteSlug: "dundee" }),
    ).toEqual({ miss: "invalid", url: SMOKE_URL, declaredSchemaVersion: 2 });
  });

  it("an invalid miss echoes the document's declared schemaVersion so a reader can say 'upgrade', not just 'invalid'", async () => {
    const run = smokePair("2026-08-08T00:00:00Z");
    const futureSmoke = { ...run.smoke, schemaVersion: 99 };
    const versioned = stubFetch({
      [SMOKE_MANIFEST_URL]: [ok(run.manifest)],
      [SMOKE_URL]: [ok(futureSmoke)],
    });
    expect(
      await loadSmoke({
        fetch: versioned.fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "dundee",
      }),
    ).toEqual({ miss: "invalid", url: SMOKE_URL, declaredSchemaVersion: 99 });

    // Unversioned garbage stays a bare invalid miss: that one is corruption.
    const garbage = stubFetch({
      [SMOKE_MANIFEST_URL]: [ok(run.manifest)],
      [SMOKE_URL]: [ok({ prototype: true })],
    });
    expect(
      await loadSmoke({
        fetch: garbage.fetch,
        baseUrl: BASE,
        modelSlug: "raqdps",
        siteSlug: "dundee",
      }),
    ).toEqual({ miss: "invalid", url: SMOKE_URL });
  });
});

const OBSERVATION_URL = `${BASE}/goes18-dsr/sites/dundee.json`;

function observationDocument(): ObservationDocument {
  return {
    schemaVersion: 1,
    model: "goes18-dsr",
    observed: {
      firstObservedAt: "2026-08-09T15:00:00Z",
      lastObservedAt: "2026-08-10T02:00:00Z",
      generatedAt: "2026-08-10T02:31:12Z",
    },
    site: { id: "dundee", name: "Dundee", latitude: 49.291977, longitude: -117.183569 },
    observations: [{ observedAt: "2026-08-09T15:00:00Z", downwardShortwaveWm2: 112.4 }],
  };
}

describe("loadObservation", () => {
  it("is a single guarded fetch — no manifest request, no pair, no retry", async () => {
    const { fetch, calls } = stubFetch({ [OBSERVATION_URL]: [ok(observationDocument())] });
    const loaded = hit(
      await loadObservation({ fetch, baseUrl: BASE, modelSlug: "goes18-dsr", siteSlug: "dundee" }),
    );
    expect(loaded.observed.lastObservedAt).toBe("2026-08-10T02:00:00Z");
    expect(calls).toEqual([OBSERVATION_URL]);
  });

  it("misses discriminate absent from invalid, and other HTTP errors still throw", async () => {
    const missing = stubFetch({});
    expect(
      await loadObservation({
        fetch: missing.fetch,
        baseUrl: BASE,
        modelSlug: "goes18-dsr",
        siteSlug: "dundee",
      }),
    ).toEqual({ miss: "absent", url: OBSERVATION_URL });

    const invalid = stubFetch({ [OBSERVATION_URL]: [ok(deterministicProfile())] });
    expect(
      await loadObservation({
        fetch: invalid.fetch,
        baseUrl: BASE,
        modelSlug: "goes18-dsr",
        siteSlug: "dundee",
      }),
    ).toEqual({ miss: "invalid", url: OBSERVATION_URL, declaredSchemaVersion: 2 });

    const failing = stubFetch({ [OBSERVATION_URL]: [status(503)] });
    await expect(
      loadObservation({
        fetch: failing.fetch,
        baseUrl: BASE,
        modelSlug: "goes18-dsr",
        siteSlug: "dundee",
      }),
    ).rejects.toThrow(TransportHttpError);
  });
});

describe("loadSiteSet", () => {
  const RED_URL = `${BASE}/hrdps-continental/sites/red-mountain.json`;
  const SLUGS = ["dundee", "red-mountain"] as const;

  function profileFor(siteSlug: string, referenceTime: string): SiteForecast {
    const profile = deterministicProfile();
    return {
      ...profile,
      run: { ...profile.run, referenceTime },
      site: { ...profile.site, id: siteSlug },
    };
  }

  function load(fetch: (url: string) => Promise<TransportResponse>) {
    return loadSiteSet({
      fetch,
      baseUrl: BASE,
      modelSlug: "hrdps-continental",
      siteSlugs: SLUGS,
      guard: parseSiteForecastJson,
      retry: noWait,
    });
  }

  function coherent(result: Awaited<ReturnType<typeof load>>) {
    if ("miss" in result || result.syncing) {
      throw new Error(`expected a coherent set: ${JSON.stringify(result)}`);
    }
    return result;
  }

  it("returns a coherent set anchored on one manifest fetch", async () => {
    const run = pair("2026-08-08T06:00:00Z");
    const { fetch, calls } = stubFetch({
      [MANIFEST_URL]: [ok(run.manifest)],
      [PROFILE_URL]: [ok(profileFor("dundee", "2026-08-08T06:00:00Z"))],
      [RED_URL]: [ok(profileFor("red-mountain", "2026-08-08T06:00:00Z"))],
    });
    const set = coherent(await load(fetch));
    expect(set.referenceTime).toBe("2026-08-08T06:00:00Z");
    expect(Object.keys(set.documents).sort()).toEqual(["dundee", "red-mountain"]);
    expect(set.misses).toEqual({});
    expect(calls).toHaveLength(3);
    expect(calls.filter((url) => url === MANIFEST_URL)).toHaveLength(1);
  });

  it("heals a mid-publish mix by refetching the manifest and only the disagreeing documents", async () => {
    const { fetch, calls } = stubFetch({
      [MANIFEST_URL]: [ok(pair("2026-08-08T06:00:00Z").manifest)],
      [PROFILE_URL]: [
        ok(profileFor("dundee", "2026-08-08T00:00:00Z")),
        ok(profileFor("dundee", "2026-08-08T06:00:00Z")),
      ],
      [RED_URL]: [ok(profileFor("red-mountain", "2026-08-08T06:00:00Z"))],
    });
    const set = coherent(await load(fetch));
    expect(set.referenceTime).toBe("2026-08-08T06:00:00Z");
    expect(set.documents["dundee"]!.run.referenceTime).toBe("2026-08-08T06:00:00Z");
    expect(calls).toHaveLength(5);
    expect(calls.filter((url) => url === RED_URL)).toHaveLength(1);
  });

  it("reports a set still mixing runs after the retry as syncing, naming the runs seen", async () => {
    const { fetch } = stubFetch({
      [MANIFEST_URL]: [ok(pair("2026-08-08T06:00:00Z").manifest)],
      [PROFILE_URL]: [ok(profileFor("dundee", "2026-08-08T00:00:00Z"))],
      [RED_URL]: [ok(profileFor("red-mountain", "2026-08-08T06:00:00Z"))],
    });
    const result = await load(fetch);
    expect(result).toEqual({
      syncing: true,
      runsSeen: ["2026-08-08T00:00:00Z", "2026-08-08T06:00:00Z"],
    });
  });

  it("treats an all-old coherent set as the previous publication, not as syncing", async () => {
    const { fetch, calls } = stubFetch({
      [MANIFEST_URL]: [ok(pair("2026-08-08T00:00:00Z").manifest)],
      [PROFILE_URL]: [ok(profileFor("dundee", "2026-08-08T00:00:00Z"))],
      [RED_URL]: [ok(profileFor("red-mountain", "2026-08-08T00:00:00Z"))],
    });
    const set = coherent(await load(fetch));
    expect(set.referenceTime).toBe("2026-08-08T00:00:00Z");
    expect(calls).toHaveLength(3);
  });

  it("keeps per-site misses discriminated without poisoning the set", async () => {
    const run = pair("2026-08-08T06:00:00Z");
    const { fetch } = stubFetch({
      [MANIFEST_URL]: [ok(run.manifest)],
      [PROFILE_URL]: [ok({ prototype: true })],
    });
    const set = coherent(await load(fetch));
    expect(set.documents).toEqual({});
    expect(set.misses).toEqual({
      dundee: { miss: "invalid", url: PROFILE_URL },
      "red-mountain": { miss: "absent", url: RED_URL },
    });
  });

  it("returns the manifest miss when the model publishes nothing, and still throws on HTTP failures", async () => {
    const missing = stubFetch({});
    expect(await load(missing.fetch)).toEqual({ miss: "absent", url: MANIFEST_URL });

    const failing = stubFetch({ [MANIFEST_URL]: [status(503)] });
    await expect(load(failing.fetch)).rejects.toThrow(TransportHttpError);
  });

  it("anchors smoke documents the same way via the guard parameter", async () => {
    const run = smokePair("2026-08-08T12:00:00Z");
    const { fetch } = stubFetch({
      [SMOKE_MANIFEST_URL]: [ok(run.manifest)],
      [SMOKE_URL]: [ok(run.smoke)],
    });
    const result = await loadSiteSet({
      fetch,
      baseUrl: BASE,
      modelSlug: "raqdps",
      siteSlugs: ["dundee"],
      guard: parseSmokeDocumentJson,
      retry: noWait,
    });
    if ("miss" in result || result.syncing) throw new Error("expected a coherent smoke set");
    expect(result.documents["dundee"]!.hours[0]!.smokePlumeColumnMgm2).toBe(200);
  });
});

describe("loadRuns", () => {
  it("loads and guards the run index", async () => {
    const { fetch } = stubFetch({ [`${BASE}/runs.json`]: [ok(runsIndex())] });
    const runs = await loadRuns({ fetch, baseUrl: BASE });
    const index = hit(runs);
    expect(index.runs["reps"]!.referenceTime).toBe("2026-08-07T12:00:00Z");
  });

  it("misses discriminate absent from invalid, and other HTTP errors still throw", async () => {
    const missing = stubFetch({});
    expect(await loadRuns({ fetch: missing.fetch, baseUrl: BASE })).toEqual({
      miss: "absent",
      url: `${BASE}/runs.json`,
    });
    const invalid = stubFetch({ [`${BASE}/runs.json`]: [ok({ runs: [] })] });
    expect(await loadRuns({ fetch: invalid.fetch, baseUrl: BASE })).toEqual({
      miss: "invalid",
      url: `${BASE}/runs.json`,
    });
    const failing = stubFetch({ [`${BASE}/runs.json`]: [status(500)] });
    await expect(loadRuns({ fetch: failing.fetch, baseUrl: BASE })).rejects.toThrow(
      TransportHttpError,
    );
  });
});
