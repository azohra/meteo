import { describe, expect, it } from "vitest";
import {
  campbellStationConfigSchema,
  loadCampbellCurrent,
  loadCampbellStation,
  naiveLocalToIso,
  parseCampbellCurrent,
  parseCampbellHistory,
} from "../src/server/index.js";
import {
  campbellCurrentPayload,
  campbellHistoryPayload,
  stubEnvironment,
  timeoutError,
} from "./support.js";

const config = campbellStationConfigSchema.parse({
  vendor: "campbell",
  id: "summit",
  name: "Summit Logger",
  baseUrl: "http://logger.example:30001/.",
  source: "LOGGER01:Wind Station",
  timeZone: "America/Vancouver",
});

function mutated(payload: string, mutate: (data: any) => void): string {
  const data = JSON.parse(payload);
  mutate(data);
  return JSON.stringify(data);
}

function campbellRoute(url: URL): string {
  const uri = url.searchParams.get("uri");
  if (uri === "LOGGER01:Wind Station.I3Sec") return campbellCurrentPayload();
  if (uri === "LOGGER01:Wind Station.I5Min") return campbellHistoryPayload();
  throw new Error(`unexpected uri ${uri}`);
}

describe("naiveLocalToIso", () => {
  it("converts an unambiguous station-local stamp", () => {
    expect(naiveLocalToIso("2025-07-01T12:00:00", "America/Vancouver")).toBe(
      "2025-07-01T19:00:00.000Z",
    );
    expect(naiveLocalToIso("2025-01-15T12:00:00", "America/Vancouver")).toBe(
      "2025-01-15T20:00:00.000Z",
    );
  });

  it("handles zones ahead of UTC", () => {
    expect(naiveLocalToIso("2025-01-01T09:00:00", "Australia/Sydney")).toBe(
      "2024-12-31T22:00:00.000Z",
    );
  });

  it("resolves a fall-back ambiguity from context", () => {
    expect(naiveLocalToIso("2025-11-02T01:30:00", "America/Vancouver")).toBe(
      "2025-11-02T08:30:00.000Z",
    );
    expect(
      naiveLocalToIso("2025-11-02T01:30:00", "America/Vancouver", {
        afterMs: Date.parse("2025-11-02T08:55:00Z"),
      }),
    ).toBe("2025-11-02T09:30:00.000Z");
    expect(
      naiveLocalToIso("2025-11-02T01:30:00", "America/Vancouver", {
        nearMs: Date.parse("2025-11-02T09:33:00Z"),
      }),
    ).toBe("2025-11-02T09:30:00.000Z");
    expect(
      naiveLocalToIso("2025-11-02T01:30:00", "America/Vancouver", {
        nearMs: Date.parse("2025-11-02T08:33:00Z"),
      }),
    ).toBe("2025-11-02T08:30:00.000Z");
  });

  it("clamps a spring-forward hole to the transition", () => {
    expect(naiveLocalToIso("2025-03-09T02:30:00", "America/Vancouver")).toBe(
      "2025-03-09T10:00:00.000Z",
    );
  });

  it("keeps a series through the repeated fall-back hour monotonic", () => {
    const stamps = [
      "2025-11-02T01:45:00",
      "2025-11-02T01:50:00",
      "2025-11-02T01:55:00",
      "2025-11-02T01:00:00",
      "2025-11-02T01:05:00",
      "2025-11-02T02:00:00",
    ];
    let previousMs: number | null = null;
    const instants = stamps.map((stamp) => {
      const iso = naiveLocalToIso(stamp, "America/Vancouver", { afterMs: previousMs });
      previousMs = Date.parse(iso);
      return iso;
    });
    expect(instants).toEqual([
      "2025-11-02T08:45:00.000Z",
      "2025-11-02T08:50:00.000Z",
      "2025-11-02T08:55:00.000Z",
      "2025-11-02T09:00:00.000Z",
      "2025-11-02T09:05:00.000Z",
      "2025-11-02T10:00:00.000Z",
    ]);
    for (let index = 1; index < instants.length; index += 1) {
      expect(Date.parse(instants[index] as string)).toBeGreaterThan(
        Date.parse(instants[index - 1] as string),
      );
    }
  });

  it("keeps a series crossing spring-forward monotonic", () => {
    const stamps = [
      "2025-03-09T01:30:00",
      "2025-03-09T01:59:00",
      "2025-03-09T02:30:00",
      "2025-03-09T03:00:00",
      "2025-03-09T03:30:00",
    ];
    const instants = stamps.map((stamp) => Date.parse(naiveLocalToIso(stamp, "America/Vancouver")));
    for (let index = 1; index < instants.length; index += 1) {
      expect(instants[index]).toBeGreaterThanOrEqual(instants[index - 1] as number);
    }
  });

  it("rejects garbage and impossible calendar dates", () => {
    expect(() => naiveLocalToIso("yesterday", "America/Vancouver")).toThrow();
    expect(() => naiveLocalToIso("2025-02-30T00:00:00", "America/Vancouver")).toThrow();
    expect(() => naiveLocalToIso("2025-07-01T12:00:00Z", "America/Vancouver")).toThrow();
  });
});

describe("parseCampbellCurrent", () => {
  it("reads the seconds-scale wind and stamps it in the station's zone", () => {
    const reading = parseCampbellCurrent(campbellCurrentPayload(), config);
    expect(reading).toEqual({
      observedAt: "2026-08-05T22:12:57.000Z",
      windAvgMps: 12.4 / 3.6,
      windDirectionDeg: 245,
      windGustMps: 18.9 / 3.6,
      windLullMps: 8.2 / 3.6,
      temperatureC: null,
      windChillC: null,
      conditions: null,
    });
  });

  it("gives calm no direction, below the WMO threshold and not only at zero", () => {
    const dead = mutated(campbellCurrentPayload(), (data) => {
      data.data[0].vals = [0, 0, 0, 245];
    });
    expect(parseCampbellCurrent(dead, config).windDirectionDeg).toBeNull();

    const drifting = mutated(campbellCurrentPayload(), (data) => {
      data.data[0].vals = [1.7, 0.9, 2.4, 245];
    });
    const calm = parseCampbellCurrent(drifting, config);
    expect(calm.windDirectionDeg).toBeNull();
    expect(calm.windAvgMps).toBe(1.7 / 3.6);

    const light = mutated(campbellCurrentPayload(), (data) => {
      data.data[0].vals = [1.8, 0.9, 2.4, 245];
    });
    expect(parseCampbellCurrent(light, config).windDirectionDeg).toBe(245);
  });

  it("resolves an ambiguous current stamp to the instant nearest now", () => {
    const payload = mutated(campbellCurrentPayload(), (data) => {
      data.data[0].time = "2025-11-02T01:10:00";
    });
    const secondPass = parseCampbellCurrent(payload, config, Date.parse("2025-11-02T09:12:00Z"));
    expect(secondPass.observedAt).toBe("2025-11-02T09:10:00.000Z");
    const firstPass = parseCampbellCurrent(payload, config, Date.parse("2025-11-02T08:11:00Z"));
    expect(firstPass.observedAt).toBe("2025-11-02T08:10:00.000Z");
  });

  it("rejects a field whose contract changed", () => {
    const payload = mutated(campbellCurrentPayload(), (data) => {
      data.head.fields[0].units = "meters/second";
    });
    expect(() => parseCampbellCurrent(payload, config)).toThrow("field Wind_Speed changed");
  });

  it("rejects a renamed field", () => {
    const payload = mutated(campbellCurrentPayload(), (data) => {
      data.head.fields[3].name = "WindDirection";
    });
    expect(() => parseCampbellCurrent(payload, config)).toThrow("field WindDir changed");
  });

  it("rejects the wrong table, station, or interval", () => {
    expect(() =>
      parseCampbellCurrent(
        mutated(campbellCurrentPayload(), (data) => {
          data.head.environment.table_name = "I1Min";
        }),
        config,
      ),
    ).toThrow("returned the wrong table");
    expect(() =>
      parseCampbellCurrent(
        mutated(campbellCurrentPayload(), (data) => {
          data.head.environment.station_name = "Snow Station";
        }),
        config,
      ),
    ).toThrow("returned the wrong table");
    expect(() =>
      parseCampbellCurrent(
        mutated(campbellCurrentPayload(), (data) => {
          data.head.environment.interval = 60_000;
        }),
        config,
      ),
    ).toThrow("returned the wrong table");
  });

  it("rejects an incomplete response and a row that lost a value", () => {
    expect(() =>
      parseCampbellCurrent(
        mutated(campbellCurrentPayload(), (data) => {
          data.more = true;
        }),
        config,
      ),
    ).toThrow("incomplete response");
    expect(() =>
      parseCampbellCurrent(
        mutated(campbellCurrentPayload(), (data) => {
          data.data[0].vals = [12.4, 8.2, 18.9];
        }),
        config,
      ),
    ).toThrow("record does not match its fields");
  });

  it("rejects a speed or direction outside physics", () => {
    expect(() =>
      parseCampbellCurrent(
        mutated(campbellCurrentPayload(), (data) => {
          data.data[0].vals[0] = -3;
        }),
        config,
      ),
    ).toThrow("invalid Wind_Speed");
    expect(() =>
      parseCampbellCurrent(
        mutated(campbellCurrentPayload(), (data) => {
          data.data[0].vals[0] = 600;
        }),
        config,
      ),
    ).toThrow("invalid Wind_Speed");
    expect(() =>
      parseCampbellCurrent(
        mutated(campbellCurrentPayload(), (data) => {
          data.data[0].vals[3] = 400;
        }),
        config,
      ),
    ).toThrow("invalid WindDir");
  });
});

describe("parseCampbellHistory", () => {
  it("maps the period records with temperature", () => {
    const history = parseCampbellHistory(campbellHistoryPayload(), config);
    expect(history.points).toHaveLength(3);
    expect(history.points[0]).toEqual({
      observedAt: "2026-08-05T22:00:00.000Z",
      windAvgMps: 11.9 / 3.6,
      windGustMps: 17.8 / 3.6,
      windLullMps: 6.1 / 3.6,
      windDirectionDeg: 250,
      temperatureC: 21.5,
    });
    expect(history.latestTemperatureC).toBe(22.1);
    expect(history.latestWindChillC).toBe(20.7);
  });

  it("gives a calm period no direction", () => {
    const payload = mutated(campbellHistoryPayload(), (data) => {
      data.data[1].vals = [21.8, 20.4, 255, 1.6, 1.2, 0.4];
    });
    const history = parseCampbellHistory(payload, config);
    expect(history.points.map((point) => point.windDirectionDeg)).toEqual([250, null, 248]);
    expect(history.points[1]?.windAvgMps).toBe(1.2 / 3.6);
  });

  it("keeps a series crossing fall-back monotonic with the right instants", () => {
    const vals = [21.5, 20.1, 250, 17.8, 11.9, 6.1];
    const payload = mutated(campbellHistoryPayload(), (data) => {
      data.data = [
        { time: "2025-11-02T01:45:00", no: 1, vals },
        { time: "2025-11-02T01:50:00", no: 2, vals },
        { time: "2025-11-02T01:55:00", no: 3, vals },
        { time: "2025-11-02T01:00:00", no: 4, vals },
        { time: "2025-11-02T01:05:00", no: 5, vals },
        { time: "2025-11-02T02:00:00", no: 6, vals },
      ];
    });
    const history = parseCampbellHistory(payload, config);
    const instants = history.points.map((point) => point.observedAt);
    expect(instants).toEqual([
      "2025-11-02T08:45:00.000Z",
      "2025-11-02T08:50:00.000Z",
      "2025-11-02T08:55:00.000Z",
      "2025-11-02T09:00:00.000Z",
      "2025-11-02T09:05:00.000Z",
      "2025-11-02T10:00:00.000Z",
    ]);
    for (let index = 1; index < instants.length; index += 1) {
      expect(Date.parse(instants[index] as string)).toBeGreaterThan(
        Date.parse(instants[index - 1] as string),
      );
    }
  });

  it("enforces the history field contract", () => {
    const payload = mutated(campbellHistoryPayload(), (data) => {
      data.head.fields[4].process = "Smp";
    });
    expect(() => parseCampbellHistory(payload, config)).toThrow("field WS_kph_Avg changed");
  });
});

describe("loadCampbellStation", () => {
  it("merges seconds-scale wind with the history table's temperature", async () => {
    const { environment, requests } = stubEnvironment(campbellRoute);
    const station = await loadCampbellStation(config, { environment, historyHours: 6 });

    expect(station.status).toBe("ok");
    if (station.status !== "ok") return;
    expect(station.reading.observedAt).toBe("2026-08-05T22:12:57.000Z");
    expect(station.reading.windAvgMps).toBe(12.4 / 3.6);
    expect(station.reading.temperatureC).toBe(22.1);
    expect(station.reading.windChillC).toBe(20.7);
    expect(station.history?.periodMinutes).toBe(5);
    expect(station.history?.points).toHaveLength(3);
    expect(station.capabilities).toEqual({
      gustLull: true,
      temperature: true,
      conditions: false,
      history: true,
    });
    expect(station.samplingWindowSeconds).toBe(3);
    expect(station.recommendedPollSeconds).toBe(15);

    const current = requests.find((url) => url.searchParams.get("uri")?.endsWith(".I3Sec"));
    expect(current?.searchParams.get("command")).toBe("DataQuery");
    expect(current?.searchParams.get("format")).toBe("json");
    expect(current?.searchParams.get("mode")).toBe("most-recent");
    expect(current?.searchParams.get("p1")).toBe("1");
    expect(current?.searchParams.get("p2")).toBe("");
    expect(current?.searchParams.get("headsig")).toBe("0");
    expect(current?.searchParams.get("nextpoll")).toBe("60000");
    expect(current?.searchParams.get("order")).toBe("real-time");

    const history = requests.find((url) => url.searchParams.get("uri")?.endsWith(".I5Min"));
    expect(history?.searchParams.get("mode")).toBe("backfill");
    expect(history?.searchParams.get("p1")).toBe(String(6 * 3600));
    expect(history?.searchParams.get("order")).toBe("collected");
  });

  it("stays ok with null history when only the history table fails", async () => {
    const { environment, logs } = stubEnvironment((url) =>
      url.searchParams.get("uri")?.endsWith(".I5Min")
        ? new Response("busy", { status: 503 })
        : campbellCurrentPayload(),
    );
    const station = await loadCampbellStation(config, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.history).toBeNull();
    expect(station.reading.windAvgMps).toBe(12.4 / 3.6);
    expect(station.reading.temperatureC).toBeNull();
    expect(station.reading.windChillC).toBeNull();
    const failure = logs.find((event) => event.level === "error");
    expect(failure?.code).toBe("upstream_failure");
    expect(failure?.message).toContain("history unavailable");
  });

  it("degrades when the current table fails, however healthy the history", async () => {
    const { environment } = stubEnvironment((url) =>
      url.searchParams.get("uri")?.endsWith(".I3Sec")
        ? new Response("busy", { status: 503 })
        : campbellHistoryPayload(),
    );
    const station = await loadCampbellStation(config, { environment });
    if (station.status !== "unavailable") throw new Error("expected unavailable");
    expect(station.reason).toBe("upstream_error");
    expect(station.reading).toBeNull();
  });

  it("degrades to timeout on an abort", async () => {
    const { environment } = stubEnvironment(() => timeoutError());
    const station = await loadCampbellStation(config, { environment });
    if (station.status !== "unavailable") throw new Error("expected unavailable");
    expect(station.reason).toBe("timeout");
  });

  it("carries the configured position and zone in meta", async () => {
    const { environment } = stubEnvironment(campbellRoute);
    const positioned = campbellStationConfigSchema.parse({
      vendor: "campbell",
      id: "summit",
      name: "Summit Logger",
      baseUrl: "http://logger.example:30001/.",
      source: "LOGGER01:Wind Station",
      timeZone: "America/Vancouver",
      latitude: 49.07,
      longitude: -117.79,
      elevationM: 2020,
    });
    const station = await loadCampbellStation(positioned, { environment });
    expect(station.latitude).toBe(49.07);
    expect(station.longitude).toBe(-117.79);
    expect(station.timeZone).toBe("America/Vancouver");
    expect(station.elevationM).toBe(2020);
  });
});

describe("loadCampbellCurrent", () => {
  it("hits only the current table and omits history", async () => {
    const { environment, requests, logs } = stubEnvironment(campbellRoute);
    const station = await loadCampbellCurrent(config, { environment });

    expect(station.status).toBe("ok");
    if (station.status !== "ok") return;
    expect(station.history).toBeNull();
    expect(station.reading.windAvgMps).toBe(12.4 / 3.6);
    expect(station.reading.temperatureC).toBeNull();
    expect(station.reading.windChillC).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("uri")).toBe("LOGGER01:Wind Station.I3Sec");
    expect(logs).toHaveLength(0);
  });

  it("fills temperature and wind chill from the cached history table", async () => {
    const { environment, requests } = stubEnvironment(campbellRoute);
    await loadCampbellStation(config, { environment });
    expect(requests).toHaveLength(2);

    const station = await loadCampbellCurrent(config, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.reading.temperatureC).toBe(22.1);
    expect(station.reading.windChillC).toBe(20.7);
    expect(requests).toHaveLength(2);
  });

  it("honors a configured current-table TTL in the advertised cadence", async () => {
    const tuned = campbellStationConfigSchema.parse({
      vendor: "campbell",
      id: "summit",
      name: "Summit Logger",
      baseUrl: "http://logger.example:30001/.",
      source: "LOGGER01:Wind Station",
      timeZone: "America/Vancouver",
      currentCacheTtlSeconds: 5,
    });
    const { environment } = stubEnvironment(campbellRoute);
    const station = await loadCampbellCurrent(tuned, { environment });
    expect(station.recommendedPollSeconds).toBe(5);
  });

  it("stamps an ambiguous current reading near the environment clock", async () => {
    const { environment, logs } = stubEnvironment(
      () =>
        mutated(campbellCurrentPayload(), (data) => {
          data.data[0].time = "2025-11-02T01:10:00";
        }),
      "2025-11-02T09:12:00Z",
    );
    const station = await loadCampbellCurrent(config, { environment });
    if (station.status !== "ok") throw new Error("expected ok");
    expect(station.reading.observedAt).toBe("2025-11-02T09:10:00.000Z");
    expect(logs).toHaveLength(0);
  });

  it("warns when the current reading sits an hour from now", async () => {
    const { environment, logs } = stubEnvironment(campbellRoute, "2026-08-05T23:13:00Z");
    const station = await loadCampbellCurrent(config, { environment });
    expect(station.status).toBe("ok");
    const warning = logs.find((event) => event.level === "warn");
    expect(warning?.code).toBe("clock_skew");
    expect(warning?.message).toContain("standard time");
    expect(warning?.message).toContain("Etc/GMT+8");
    expect(warning?.detail).toMatchObject({ station: "summit", timeZone: "America/Vancouver" });
  });
});
