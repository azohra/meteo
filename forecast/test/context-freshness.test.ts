import { describe, expect, it } from "vitest";
import { publishedContextFresh } from "../src/context-freshness.js";
import type { TransportFetch } from "../src/providers/transport.js";
import { noSleep, useCleanWireEnv } from "./helpers/wire.js";

useCleanWireEnv();

const POINT = { latitude: 49.291977, longitude: -117.183569 };
const SITES = {
  schemaVersion: 2,
  sites: [{ slug: "dundee", name: "Dundee", ...POINT, timeZone: "America/Vancouver" }],
};

function contextWith(point: object | undefined) {
  return {
    schemaVersion: point === undefined ? 2 : 3,
    generatedAt: "2026-08-17T08:00:00Z",
    sources: [
      {
        id: "glo30",
        product: "Copernicus GLO-30 DEM",
        kind: "surfaceModel",
        resolutionM: 30,
        licence: "Copernicus DEM licence",
        attribution: "produced using Copernicus WorldDEM-30",
        url: "https://registry.opendata.aws/copernicus-dem/",
      },
    ],
    sites: {
      dundee: {
        ...(point === undefined ? {} : { point }),
        elevation: { source: "glo30", elevationM: 1492.1 },
        terrain: {
          source: "glo30",
          elevationM: 1492.1,
          slopeDeg: 18.3,
          aspectDeg: 241,
          relief: [{ radiusKm: 1, minM: 896, maxM: 1666, percentile: 80 }],
        },
        landCover: {
          source: "glo30",
          atLaunch: "grassland",
          fractions: [{ radiusKm: 1, byClass: { grassland: 1 } }],
        },
      },
    },
  };
}

function wire(bodies: Record<string, unknown>): TransportFetch {
  return async (url: string) => {
    const key = url.split("/").slice(-1)[0];
    const body = bodies[key];
    const bytes = new TextEncoder().encode(body === undefined ? "" : JSON.stringify(body));
    return {
      status: body === undefined ? 404 : 200,
      headers: new Headers(),
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    };
  };
}

function options(bodies: Record<string, unknown>) {
  process.env["METEO_DATA_BASE"] = "https://data.test";
  return { fetch: wire(bodies), sleep: noSleep };
}

describe("publishedContextFresh", () => {
  it("fresh exactly when every catalogued site's measured point equals the catalogue's", async () => {
    expect(
      await publishedContextFresh(
        options({ "sites.json": SITES, "site-context.json": contextWith(POINT) }),
      ),
    ).toBe(true);
  });

  it("a moved point is stale — the context describes ground the catalogue left", async () => {
    expect(
      await publishedContextFresh(
        options({
          "sites.json": SITES,
          "site-context.json": contextWith({ ...POINT, latitude: 49.3 }),
        }),
      ),
    ).toBe(false);
  });

  it("a v2 context is stale by definition — its measurements name no point", async () => {
    expect(
      await publishedContextFresh(
        options({ "sites.json": SITES, "site-context.json": contextWith(undefined) }),
      ),
    ).toBe(false);
  });

  it("an absent context, and a catalogued site the context never measured, are stale", async () => {
    expect(await publishedContextFresh(options({ "sites.json": SITES }))).toBe(false);
    const twoSites = {
      ...SITES,
      sites: [
        ...SITES.sites,
        {
          slug: "erie",
          name: "Erie",
          latitude: 49.2,
          longitude: -117.4,
          timeZone: "America/Vancouver",
        },
      ],
    };
    expect(
      await publishedContextFresh(
        options({ "sites.json": twoSites, "site-context.json": contextWith(POINT) }),
      ),
    ).toBe(false);
  });

  it("no catalogue means no verdict — it throws rather than guessing", async () => {
    await expect(publishedContextFresh(options({}))).rejects.toThrowError(/no sites\.json/);
    await expect(
      publishedContextFresh(options({ "sites.json": { prototype: true } })),
    ).rejects.toThrowError(/contract guard/);
  });
});
