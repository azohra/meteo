import { describe, expect, it } from "vitest";
import {
  parseStationCurrent,
  parseStationFeed,
  parseStationHistory,
  parseStationLiveFrame,
} from "../src/index.js";
import { createStationFeedHandler, type StationConfigInput } from "../src/server/index.js";
import {
  campbellCurrentPayload,
  campbellHistoryPayload,
  sseResponse,
  stubEnvironment,
  tempestPayload,
  windnerdLiveInitPayload,
  windnerdPayload,
  type StubRoute,
} from "./support.js";

const stations: StationConfigInput[] = [
  {
    vendor: "windnerd",
    id: "bluff",
    name: "Bluff Launch",
    stationKey: "bluff-launch",
    locationId: 8675,
  },
  { vendor: "tempest", id: "base", name: "Ridge Meadow", stationId: 12345, token: "tok" },
  {
    vendor: "campbell",
    id: "summit",
    name: "Summit Logger",
    baseUrl: "http://logger.example:30001/.",
    source: "LOGGER01:Wind Station",
    timeZone: "America/Vancouver",
  },
];

const allUpstreamsHealthy: StubRoute = (url) => {
  if (url.hostname === "windnerd.net") return windnerdPayload();
  if (url.hostname === "swd.weatherflow.com") return tempestPayload();
  if (url.hostname === "logger.example") {
    return url.searchParams.get("uri")?.endsWith(".I5Min")
      ? campbellHistoryPayload()
      : campbellCurrentPayload();
  }
  throw new Error(`unexpected host ${url.hostname}`);
};

type HandlerOptions = Partial<Parameters<typeof createStationFeedHandler>[0]>;

function handlerWith(route: StubRoute, options: HandlerOptions = {}) {
  const stub = stubEnvironment(route);
  const handler = createStationFeedHandler({
    stations,
    primaryStationId: "bluff",
    environment: stub.environment,
    ...options,
  });
  return { handler, ...stub };
}

describe("createStationFeedHandler /feed", () => {
  it("serves a full feed that round-trips through the wire schema", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const response = await handler(new Request("https://example.test/wind/feed"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=15");

    const feed = parseStationFeed(await response.json());
    expect(feed).not.toBeNull();
    expect(feed?.servedAt).toBe("2026-08-05T22:13:00.000Z");
    expect(feed?.primaryStationId).toBe("bluff");
    expect(feed?.stations.map((station) => [station.id, station.status])).toEqual([
      ["bluff", "ok"],
      ["base", "ok"],
      ["summit", "ok"],
    ]);
    const summit = feed?.stations.find((station) => station.id === "summit");
    expect(summit?.status === "ok" && summit.history?.points).toHaveLength(3);
  });

  it("isolates one upstream's failure to its own station", async () => {
    const { handler } = handlerWith((url) =>
      url.hostname === "windnerd.net"
        ? new Response("down", { status: 502 })
        : allUpstreamsHealthy(url),
    );
    const response = await handler(new Request("https://example.test/wind/feed"));
    const feed = parseStationFeed(await response.json());

    expect(feed).not.toBeNull();
    const bluff = feed?.stations.find((station) => station.id === "bluff");
    expect(bluff?.status).toBe("unavailable");
    expect(bluff?.status === "unavailable" && bluff.reason).toBe("upstream_error");
    expect(bluff?.reading).toBeNull();
    for (const id of ["base", "summit"]) {
      expect(feed?.stations.find((station) => station.id === id)?.status).toBe("ok");
    }
  });

  it("routes on the path suffix, wherever the handler is mounted", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const response = await handler(new Request("https://example.test/api/v2/wind/feed"));
    expect(response.status).toBe(200);
  });

  it("tolerates one trailing slash, no more", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const slashed = await handler(new Request("https://example.test/wind/feed/"));
    expect(slashed.status).toBe(200);
    const doubled = await handler(new Request("https://example.test/wind/feed//"));
    expect(doubled.status).toBe(404);
  });

  it("serves HEAD as GET without a body", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const head = await handler(new Request("https://example.test/wind/feed", { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toContain("application/json");
    expect(head.headers.get("Cache-Control")).toBe("public, max-age=15");
    expect(await head.text()).toBe("");
  });
});

describe("createStationFeedHandler /current", () => {
  it("serves one station's reading without history", async () => {
    const { handler, requests } = handlerWith(allUpstreamsHealthy);
    const response = await handler(new Request("https://example.test/wind/current?station=summit"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=15");
    const current = parseStationCurrent(await response.json());
    expect(current).not.toBeNull();
    expect(current?.station.id).toBe("summit");
    expect(current?.station.history).toBeNull();
    expect(current?.station.status === "ok" && current.station.reading.windAvgMps).toBe(12.4 / 3.6);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("uri")).toBe("LOGGER01:Wind Station.I3Sec");
  });

  it("slims the windnerd response without a second upstream call shape", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const response = await handler(new Request("https://example.test/wind/current?station=bluff"));
    const current = parseStationCurrent(await response.json());
    expect(current?.station.history).toBeNull();
    expect(current?.station.status).toBe("ok");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("404s an unknown station but 400s a missing station parameter", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const unknown = await handler(new Request("https://example.test/wind/current?station=nope"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "unknown station" });

    const missing = await handler(new Request("https://example.test/wind/current"));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "missing station parameter" });
  });
});

describe("createStationFeedHandler /climatology", () => {
  const climatologyRoute: StubRoute = (url) => {
    if (url.pathname.includes("/api/live-url/")) {
      return sseResponse({ data: windnerdLiveInitPayload() });
    }
    if (url.hostname === "windnerd.net") return windnerdPayload();
    throw new Error(`unexpected host ${url.hostname}`);
  };
  const climatology = { thresholds: { unit: "kmh" as const, values: [12, 20, 28] }, years: 2 };

  it("404s when the host mounted no climatology judgment", async () => {
    const { handler } = handlerWith(climatologyRoute);
    const response = await handler(new Request("http://host/api/climatology?station=bluff"));
    expect(response.status).toBe(404);
  });

  it("serves the cube with a long cache life and honours If-None-Match", async () => {
    const { handler } = handlerWith(climatologyRoute, { climatology });
    const response = await handler(new Request("http://host/api/climatology?station=bluff"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=21600");
    const etag = response.headers.get("ETag");
    expect(etag).not.toBeNull();
    const document = (await response.json()) as { schemaVersion: number; stationId: string };
    expect(document.schemaVersion).toBe(1);
    expect(document.stationId).toBe("bluff");

    const revalidated = await handler(
      new Request("http://host/api/climatology?station=bluff", {
        headers: { "If-None-Match": etag as string },
      }),
    );
    expect(revalidated.status).toBe(304);
  });

  it("404s a vendor with no archive, 404s an unknown station, 400s a missing parameter", async () => {
    const { handler } = handlerWith(climatologyRoute, { climatology });
    expect((await handler(new Request("http://host/api/climatology?station=base"))).status).toBe(
      404,
    );
    expect((await handler(new Request("http://host/api/climatology?station=nope"))).status).toBe(
      404,
    );
    expect((await handler(new Request("http://host/api/climatology"))).status).toBe(400);
  });

  it("502s when the archive itself is refused", async () => {
    const { handler } = handlerWith(
      (url) =>
        url.pathname.includes("/api/live-url/")
          ? sseResponse({ data: windnerdLiveInitPayload() })
          : new Response("down", { status: 502 }),
      { climatology },
    );
    const response = await handler(new Request("http://host/api/climatology?station=bluff"));
    expect(response.status).toBe(502);
  });
});

describe("createStationFeedHandler /history", () => {
  const WINDOW = "from=2026-08-05T00:00:00.000Z&to=2026-08-05T12:00:00.000Z&period=60";

  it("serves a requested window that round-trips through the wire schema", async () => {
    const { handler, requests } = handlerWith(allUpstreamsHealthy);
    const response = await handler(new Request(`http://host/api/history?station=bluff&${WINDOW}`));
    expect(response.status).toBe(200);
    const document = parseStationHistory(await response.json());
    expect(document?.stationId).toBe("bluff");
    expect(document?.history.periodMinutes).toBe(60);
    /* A fully-past window is immutable and caches long. */
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(requests[0]?.searchParams.get("period")).toBe("60");

    const etag = response.headers.get("ETag");
    const revalidated = await handler(
      new Request(`http://host/api/history?station=bluff&${WINDOW}`, {
        headers: { "If-None-Match": etag as string },
      }),
    );
    expect(revalidated.status).toBe(304);
  });

  it("400s a bad window, a bad period, and a window over the point budget", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const status = async (query: string) =>
      (await handler(new Request(`http://host/api/history?station=bluff&${query}`))).status;
    expect(await status("from=yesterday&to=2026-08-05T12:00:00Z&period=60")).toBe(400);
    expect(await status("from=2026-08-05T12:00:00Z&to=2026-08-05T00:00:00Z&period=60")).toBe(400);
    expect(await status(`${WINDOW.replace("period=60", "period=0")}`)).toBe(400);
    /* Vendor-refused period: valid shape, not in the catalogue. */
    expect(await status(`${WINDOW.replace("period=60", "period=7")}`)).toBe(400);
    /* A year at one minute blows the point budget. */
    expect(await status("from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z&period=1")).toBe(400);
  });

  it("404s a vendor with no archive and an unknown station; 400s a missing station", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    expect(
      (await handler(new Request(`http://host/api/history?station=base&${WINDOW}`))).status,
    ).toBe(404);
    expect(
      (await handler(new Request(`http://host/api/history?station=nope&${WINDOW}`))).status,
    ).toBe(404);
    expect((await handler(new Request(`http://host/api/history?${WINDOW}`))).status).toBe(400);
  });

  it("502s when the archive upstream is refused", async () => {
    const { handler } = handlerWith(() => new Response("down", { status: 502 }));
    const response = await handler(new Request(`http://host/api/history?station=bluff&${WINDOW}`));
    expect(response.status).toBe(502);
  });
});

describe("createStationFeedHandler configuration", () => {
  const invalidCampbell = {
    vendor: "campbell",
    id: "summit",
    name: "Summit Logger",
    baseUrl: "http://logger.example:30001/.",
    timeZone: "America/Vancouver",
  } as StationConfigInput;

  it("warns about an invalid static config at construction without throwing", () => {
    const stub = stubEnvironment(allUpstreamsHealthy);
    createStationFeedHandler({ stations: [invalidCampbell], environment: stub.environment });
    const warning = stub.logs.find((event) => event.level === "warn");
    expect(warning?.message).toContain("index 0 is invalid");
    expect(JSON.stringify(warning?.detail)).toContain("source");
  });

  it("warns about a misspelled key at construction without throwing", () => {
    const stub = stubEnvironment(allUpstreamsHealthy);
    createStationFeedHandler({
      stations: [
        {
          vendor: "tempest",
          id: "base",
          name: "Ridge Meadow",
          stationId: 12345,
          token: "tok",
          stationsId: 1,
        } as StationConfigInput,
      ],
      environment: stub.environment,
    });
    expect(stub.logs.some((event) => event.level === "warn")).toBe(true);
  });

  it("serves an invalid station as not_configured beside healthy siblings", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy, {
      stations: [...stations, invalidCampbell],
    });
    const response = await handler(new Request("https://example.test/wind/feed"));
    expect(response.status).toBe(200);
    const feed = parseStationFeed(await response.json());
    expect(feed?.stations).toHaveLength(4);
    const broken = feed?.stations[3];
    expect(broken?.status).toBe("unavailable");
    expect(broken?.status === "unavailable" && broken.reason).toBe("not_configured");
    expect(broken?.id).toBe("summit");
    for (const id of ["bluff", "base"]) {
      expect(feed?.stations.find((station) => station.id === id)?.status).toBe("ok");
    }
  });
});

describe("createStationFeedHandler ?hours=", () => {
  it("threads a narrower window to the adapters", async () => {
    const { handler, requests } = handlerWith(allUpstreamsHealthy);
    const response = await handler(new Request("https://example.test/wind/feed?hours=1.5"));
    expect(response.status).toBe(200);

    const windnerd = requests.find((url) => url.hostname === "windnerd.net");
    expect(windnerd?.searchParams.get("from")).toBe("2026-08-05T20:43:00.000Z");
    const campbellHistory = requests.find((url) => url.searchParams.get("uri")?.endsWith(".I5Min"));
    expect(campbellHistory?.searchParams.get("p1")).toBe(String(1.5 * 3600));
  });

  it("quantizes hours onto the quarter-hour grid, bounding the distinct upstream cache keys a client can mint", async () => {
    const { handler, requests } = handlerWith(allUpstreamsHealthy);
    const response = await handler(new Request("https://example.test/wind/feed?hours=1.3"));
    expect(response.status).toBe(200);
    const windnerd = requests.find((url) => url.hostname === "windnerd.net");
    expect(windnerd?.searchParams.get("from")).toBe("2026-08-05T20:58:00.000Z");
  });

  it("defaults to the constructed window", async () => {
    const { handler, requests } = handlerWith(allUpstreamsHealthy, { maxHistoryHours: 3 });
    await handler(new Request("https://example.test/wind/feed"));
    const windnerd = requests.find((url) => url.hostname === "windnerd.net");
    expect(windnerd?.searchParams.get("from")).toBe("2026-08-05T19:13:00.000Z");
  });

  it("400s an out-of-range or unparseable hours", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy, { maxHistoryHours: 6 });
    for (const hours of ["0", "-2", "6.01", "abc", ""]) {
      const response = await handler(new Request(`https://example.test/wind/feed?hours=${hours}`));
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain("hours");
    }
    const atCeiling = await handler(new Request("https://example.test/wind/feed?hours=6"));
    expect(atCeiling.status).toBe(200);
  });

  it("validates hours on /current too", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const response = await handler(
      new Request("https://example.test/wind/current?station=summit&hours=99"),
    );
    expect(response.status).toBe(400);
  });
});

describe("createStationFeedHandler caching", () => {
  it("revalidates to 304 while the stations content is unchanged", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const first = await handler(new Request("https://example.test/wind/feed"));
    const etag = first.headers.get("ETag");
    expect(etag).toMatch(/^W\/"[0-9a-f]{16}"$/);

    const revalidated = await handler(
      new Request("https://example.test/wind/feed", {
        headers: { "If-None-Match": etag as string },
      }),
    );
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("ETag")).toBe(etag);
    expect(revalidated.headers.get("Cache-Control")).toBe("public, max-age=15");
    expect(await revalidated.text()).toBe("");
  });

  it("serves 200 with a new ETag when a reading changes", async () => {
    const first = handlerWith(allUpstreamsHealthy);
    const before = await first.handler(new Request("https://example.test/wind/feed"));
    const staleEtag = before.headers.get("ETag") as string;

    const changed = handlerWith((url) =>
      url.hostname === "windnerd.net"
        ? windnerdPayload({ wind_avg_1D: [6, 12, 25] })
        : allUpstreamsHealthy(url),
    );
    const response = await changed.handler(
      new Request("https://example.test/wind/feed", {
        headers: { "If-None-Match": staleEtag },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).not.toBe(staleEtag);
  });

  it("revalidates /current with its own ETag", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const first = await handler(new Request("https://example.test/wind/current?station=summit"));
    const etag = first.headers.get("ETag") as string;
    const revalidated = await handler(
      new Request("https://example.test/wind/current?station=summit", {
        headers: { "If-None-Match": etag },
      }),
    );
    expect(revalidated.status).toBe(304);
  });

  it("lets the host override Cache-Control per route", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy, {
      cacheControl: (route, maxAge) =>
        `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=30`,
    });
    const response = await handler(new Request("https://example.test/wind/feed"));
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
    );

    const { handler: fixed } = handlerWith(allUpstreamsHealthy, { cacheControl: "no-store" });
    const pinned = await fixed(new Request("https://example.test/wind/feed"));
    expect(pinned.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("createStationFeedHandler dynamic stations", () => {
  it("calls a stations resolver per request with the Request", async () => {
    const stub = stubEnvironment(allUpstreamsHealthy);
    const seen: Array<string | undefined> = [];
    const handler = createStationFeedHandler({
      stations: async (request) => {
        seen.push(request?.url);
        return stations;
      },
      environment: stub.environment,
    });

    const first = await handler(new Request("https://example.test/wind/feed"));
    expect(first.status).toBe(200);
    await handler(new Request("https://example.test/wind/current?station=base"));
    expect(seen).toEqual([
      "https://example.test/wind/feed",
      "https://example.test/wind/current?station=base",
    ]);
  });
});

describe("createStationFeedHandler routing", () => {
  it("404s an unknown path", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const response = await handler(new Request("https://example.test/wind/summary"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
  });

  it("405s anything but GET, naming what is allowed", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const response = await handler(
      new Request("https://example.test/wind/feed", { method: "POST" }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD, OPTIONS");
  });

  it("pins routing to an exact mount when basePath is given", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy, { basePath: "/wind" });
    const exact = await handler(new Request("https://example.test/wind/feed"));
    expect(exact.status).toBe(200);
    const foreign = await handler(new Request("https://example.test/other/feed"));
    expect(foreign.status).toBe(404);
    const current = await handler(new Request("https://example.test/wind/current?station=summit"));
    expect(current.status).toBe(200);
  });

  it("serves CORS headers and preflight when enabled", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy, { cors: true });
    const feed = await handler(new Request("https://example.test/wind/feed"));
    expect(feed.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const preflight = await handler(
      new Request("https://example.test/wind/feed", { method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("pins CORS to a single origin when given one", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy, { cors: "https://club.example" });
    const response = await handler(new Request("https://example.test/wind/feed"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://club.example");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("omits CORS headers and preflight when disabled", async () => {
    const { handler } = handlerWith(allUpstreamsHealthy);
    const feed = await handler(new Request("https://example.test/wind/feed"));
    expect(feed.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const preflight = await handler(
      new Request("https://example.test/wind/feed", { method: "OPTIONS" }),
    );
    expect(preflight.status).toBe(405);
  });
});

describe("createStationFeedHandler /live", () => {
  const liveAware: StubRoute = (url) =>
    url.pathname.includes("/api/live-url/")
      ? sseResponse({ data: windnerdLiveInitPayload() })
      : allUpstreamsHealthy(url);

  it("serves the live stream with SSE headers and no caching", async () => {
    const { handler } = handlerWith(liveAware, { cors: true });
    const response = await handler(new Request("https://example.test/wind/live?station=bluff"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-store");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("ETag")).toBeNull();

    const body = await response.text();
    const frames = body
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => parseStationLiveFrame(JSON.parse(chunk.slice(6))));
    expect(frames[0]?.type).toBe("init");
    if (frames[0]?.type !== "init") throw new Error("expected init");
    expect(frames[0].station.id).toBe("bluff");
    expect(frames.at(-1)?.type).toBe("unavailable");
  });

  it("rejects a live request without a station", async () => {
    const { handler } = handlerWith(liveAware);
    const response = await handler(new Request("https://example.test/wind/live"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "missing station parameter" });
  });

  it("404s an unknown station and a station without a live arm", async () => {
    const { handler } = handlerWith(liveAware);

    const unknown = await handler(new Request("https://example.test/wind/live?station=nowhere"));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "unknown station" });

    const unsupported = await handler(new Request("https://example.test/wind/live?station=summit"));
    expect(unsupported.status).toBe(404);
    expect(await unsupported.json()).toEqual({ error: "station has no live stream" });
  });

  it("502s a failed connect with the mapped reason in the body", async () => {
    const { handler } = handlerWith((url) =>
      url.pathname.includes("/api/live-url/")
        ? new Response("down", { status: 502 })
        : allUpstreamsHealthy(url),
    );
    const response = await handler(new Request("https://example.test/wind/live?station=bluff"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "live stream unavailable",
      reason: "upstream_error",
    });
  });

  it("answers HEAD with the stream headers and opens no upstream connection", async () => {
    const { handler, requests } = handlerWith(liveAware);
    const response = await handler(
      new Request("https://example.test/wind/live?station=bluff", { method: "HEAD" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(await response.text()).toBe("");
    expect(requests).toHaveLength(0);
  });

  it("ignores the hours parameter — live carries no history", async () => {
    const { handler } = handlerWith(liveAware);
    const response = await handler(
      new Request("https://example.test/wind/live?station=bluff&hours=9999"),
    );
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it("routes live under a pinned basePath too", async () => {
    const { handler } = handlerWith(liveAware, { basePath: "/wind" });
    const response = await handler(new Request("https://example.test/wind/live?station=bluff"));
    expect(response.status).toBe(200);
    await response.body?.cancel();
  });
});
