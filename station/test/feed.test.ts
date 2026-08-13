import { describe, expect, it } from "vitest";
import { parseStationCurrent, parseStationFeed, type Station } from "../src/index.js";
import {
  UnknownStationError,
  UpstreamError,
  loadStationCurrent,
  loadStationFeed,
  type CustomStationContext,
  type StationConfigInput,
} from "../src/server/index.js";
import {
  campbellCurrentPayload,
  campbellHistoryPayload,
  stubEnvironment,
  tempestPayload,
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

function customStation(): Station {
  return {
    id: "ridge",
    name: "Ridge Sensor",
    sourceLabel: "Acme Anemometer",
    pageUrl: null,
    latitude: 49.5,
    longitude: -117.5,
    timeZone: "America/Vancouver",
    elevationM: 1800,
    capabilities: { gustLull: false, temperature: false, conditions: false, history: false },
    samplingWindowSeconds: null,
    recommendedPollSeconds: 30,
    status: "ok",
    reading: {
      observedAt: "2026-08-05T22:12:00.000Z",
      windAvgMps: 14,
      windDirectionDeg: 270,
      windGustMps: null,
      windLullMps: null,
      temperatureC: null,
      windChillC: null,
      conditions: null,
    },
    history: null,
  };
}

describe("loadStationFeed", () => {
  it("owns schemaVersion, servedAt, and the primary id", async () => {
    const { environment } = stubEnvironment(allUpstreamsHealthy);
    const feed = await loadStationFeed({ stations, primaryStationId: "bluff", environment });

    expect(parseStationFeed(feed)).not.toBeNull();
    expect(feed.schemaVersion).toBe(2);
    expect(feed.servedAt).toBe("2026-08-05T22:13:00.000Z");
    expect(feed.primaryStationId).toBe("bluff");
    expect(feed.stations.map((station) => station.status)).toEqual(["ok", "ok"]);
  });

  it("degrades an invalid config to not_configured beside healthy siblings", async () => {
    const { environment, logs } = stubEnvironment(allUpstreamsHealthy);
    const feed = await loadStationFeed({
      stations: [
        ...stations,
        { vendor: "tempest", id: "broken", name: "No Token", stationId: 1 } as StationConfigInput,
      ],
      environment,
    });

    expect(feed.stations.map((station) => [station.id, station.status])).toEqual([
      ["bluff", "ok"],
      ["base", "ok"],
      ["broken", "unavailable"],
    ]);
    const broken = feed.stations[2];
    expect(broken?.status === "unavailable" && broken.reason).toBe("not_configured");
    const warning = logs.find((event) => event.level === "warn");
    expect(warning?.code).toBe("config_invalid");
    expect(warning?.message).toContain("index 2 is invalid");
    expect(JSON.stringify(warning?.detail)).toContain("token");
  });

  it("degrades a duplicate station id to not_configured, keeping the first", async () => {
    const { environment, logs } = stubEnvironment(allUpstreamsHealthy);
    const feed = await loadStationFeed({
      stations: [...stations, { ...stations[0] } as StationConfigInput],
      environment,
    });

    expect(feed.stations.map((station) => [station.id, station.status])).toEqual([
      ["bluff", "ok"],
      ["base", "ok"],
      ["bluff", "unavailable"],
    ]);
    const duplicate = feed.stations[2];
    expect(duplicate?.status === "unavailable" && duplicate.reason).toBe("not_configured");
    expect(logs.some((event) => event.code === "duplicate_station")).toBe(true);
  });

  it("clamps historyHours to maxHistoryHours", async () => {
    const { environment, requests } = stubEnvironment(allUpstreamsHealthy);
    await loadStationFeed({ stations, historyHours: 12, maxHistoryHours: 4, environment });
    const windnerd = requests.find((url) => url.hostname === "windnerd.net");
    expect(windnerd?.searchParams.get("from")).toBe("2026-08-05T18:13:00.000Z");
  });

  it("resolves a stations function, without a request when none is given", async () => {
    const { environment } = stubEnvironment(allUpstreamsHealthy);
    const seen: unknown[] = [];
    const feed = await loadStationFeed({
      stations: async (request) => {
        seen.push(request);
        return stations;
      },
      environment,
    });
    expect(feed.stations).toHaveLength(2);
    expect(seen).toEqual([undefined]);
  });
});

describe("loadStationFeed custom stations", () => {
  it("flows a valid custom loader through like a built-in", async () => {
    const { environment } = stubEnvironment(allUpstreamsHealthy);
    const contexts: CustomStationContext[] = [];
    const feed = await loadStationFeed({
      stations: [
        ...stations,
        {
          vendor: "custom",
          id: "ridge",
          name: "Ridge Sensor",
          load: async (context) => {
            contexts.push(context);
            return customStation();
          },
        },
      ],
      historyHours: 2,
      environment,
    });

    expect(parseStationFeed(feed)).not.toBeNull();
    const ridge = feed.stations.find((station) => station.id === "ridge");
    expect(ridge?.status).toBe("ok");
    expect(ridge?.sourceLabel).toBe("Acme Anemometer");
    expect(ridge?.status === "ok" && ridge.reading.windAvgMps).toBe(14);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.mode).toBe("full");
    expect(contexts[0]?.historyHours).toBe(2);
    expect(typeof contexts[0]?.environment.fetch).toBe("function");
  });

  it("hands the loader its parsed config identity, nullish claims as null", async () => {
    const { environment } = stubEnvironment(allUpstreamsHealthy);
    const contexts: CustomStationContext[] = [];
    await loadStationFeed({
      stations: [
        {
          vendor: "custom",
          id: "ridge",
          name: "Ridge Sensor",
          latitude: 49.5,
          timeZone: "America/Vancouver",
          load: async (context) => {
            contexts.push(context);
            return customStation();
          },
        },
      ],
      environment,
    });
    expect(contexts[0]?.station).toEqual({
      id: "ridge",
      name: "Ridge Sensor",
      latitude: 49.5,
      timeZone: "America/Vancouver",
      longitude: null,
      elevationM: null,
      pageUrl: null,
    });
  });

  it("degrades a contract-breaking return to unavailable/contract_break", async () => {
    const { environment, logs } = stubEnvironment(allUpstreamsHealthy);
    const feed = await loadStationFeed({
      stations: [
        {
          vendor: "custom",
          id: "ridge",
          name: "Ridge Sensor",
          latitude: 49.5,
          load: async () =>
            ({
              ...customStation(),
              reading: { ...customStation().reading, windAvgMps: "brisk" },
            }) as unknown as Station,
        },
      ],
      environment,
    });

    const ridge = feed.stations[0];
    expect(ridge?.status).toBe("unavailable");
    expect(ridge?.status === "unavailable" && ridge.reason).toBe("contract_break");
    expect(ridge?.latitude).toBe(49.5);
    expect(ridge?.sourceLabel).toBe("custom");
    expect(logs.some((event) => event.code === "custom_contract_break")).toBe(true);
  });

  it("belts an unclassified throwing custom loader into contract_break", async () => {
    const { environment, logs } = stubEnvironment(allUpstreamsHealthy);
    const feed = await loadStationFeed({
      stations: [
        {
          vendor: "custom",
          id: "ridge",
          name: "Ridge Sensor",
          load: async () => {
            throw new Error("database on fire");
          },
        },
      ],
      environment,
    });
    const ridge = feed.stations[0];
    expect(ridge?.status === "unavailable" && ridge.reason).toBe("contract_break");
    expect(logs.some((event) => event.code === "upstream_failure")).toBe(true);
  });

  it("maps a thrown UpstreamError through its honest reason", async () => {
    const { environment, logs } = stubEnvironment(allUpstreamsHealthy);
    const feed = await loadStationFeed({
      stations: [
        {
          vendor: "custom",
          id: "ridge",
          name: "Ridge Sensor",
          load: async () => {
            throw new UpstreamError("acme device took too long", "timeout");
          },
        },
      ],
      environment,
    });
    const ridge = feed.stations[0];
    expect(ridge?.status === "unavailable" && ridge.reason).toBe("timeout");
    const failure = logs.find((event) => event.code === "upstream_failure");
    expect(failure?.message).toContain("live wind unavailable");
  });
});

describe("loadStationCurrent", () => {
  it("serves one station, history omitted, in current mode", async () => {
    const { environment } = stubEnvironment(allUpstreamsHealthy);
    const contexts: CustomStationContext[] = [];
    const current = await loadStationCurrent({
      stations: [
        ...stations,
        {
          vendor: "custom",
          id: "ridge",
          name: "Ridge Sensor",
          load: async (context) => {
            contexts.push(context);
            return customStation();
          },
        },
      ],
      environment,
      stationId: "ridge",
    });

    expect(parseStationCurrent(current)).not.toBeNull();
    expect(current.station.id).toBe("ridge");
    expect(current.station.history).toBeNull();
    expect(contexts[0]?.mode).toBe("current");
  });

  it("throws UnknownStationError for an id nobody configured", async () => {
    const { environment } = stubEnvironment(allUpstreamsHealthy);
    await expect(
      loadStationCurrent({ stations, environment, stationId: "nope" }),
    ).rejects.toBeInstanceOf(UnknownStationError);
  });

  it("serves a degraded not_configured station for a matching invalid config", async () => {
    const { environment } = stubEnvironment(allUpstreamsHealthy);
    const current = await loadStationCurrent({
      stations: [
        { vendor: "tempest", id: "broken", name: "No Token", stationId: 1 } as StationConfigInput,
      ],
      environment,
      stationId: "broken",
    });
    expect(current.station.status).toBe("unavailable");
    expect(current.station.status === "unavailable" && current.station.reason).toBe(
      "not_configured",
    );
  });
});
