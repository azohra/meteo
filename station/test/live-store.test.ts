import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStationLiveStore,
  createStationStore,
  liveSnapshotToCurrent,
} from "../src/client/index.js";
import type { StationLiveStore } from "../src/client/index.js";
import type { LiveSample, StationLiveFrame } from "../src/index.js";
import { BASE_MS, feedFixture, iso, okStation } from "./fixtures.js";

type PushConnection = {
  push(frame: StationLiveFrame | string): void;
  close(): void;
  wasCancelled(): boolean;
};

function connectionQueue() {
  const connections: PushConnection[] = [];
  const encoder = new TextEncoder();
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    /* The body is deliberately not wired to the fetch signal — the store's
     * sseEvents signal race must tear reads down on its own. */
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        cancelled = true;
      },
    });
    connections.push({
      push(frame) {
        const data = typeof frame === "string" ? frame : JSON.stringify(frame);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      },
      close() {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      },
      wasCancelled: () => cancelled,
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  return { connections, fetchMock };
}

function samplePoint(offsetSeconds: number, windMps = 2.5): LiveSample {
  return {
    observedAt: iso(BASE_MS + offsetSeconds * 1_000),
    windMps,
    windDirectionDeg: 270,
  };
}

function initFrame(points: LiveSample[], servedAtMs = BASE_MS): StationLiveFrame {
  return {
    type: "init",
    schemaVersion: 2,
    servedAt: iso(servedAtMs),
    station: {
      ...okStation(),
      history: null,
      telemetry: { batteryVoltage: 4.15 },
      samples: { intervalSeconds: 3, points },
    },
  };
}

const nextChange = (store: StationLiveStore | { subscribe(l: () => void): () => void }) =>
  new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createStationLiveStore", () => {
  it("seeds from the init frame and folds sample batches into the window", async () => {
    const { connections, fetchMock } = connectionQueue();
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationLiveStore("/wind", "test-station");
    store.start();
    await settle();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/wind/live?station=test-station");

    connections[0]?.push(initFrame([samplePoint(0), samplePoint(3)]));
    await settle();
    let snapshot = store.getSnapshot();
    expect(snapshot.status).toBe("open");
    expect(snapshot.station?.id).toBe("test-station");
    expect(snapshot.samples.map((sample) => sample.observedAt)).toEqual([
      iso(BASE_MS),
      iso(BASE_MS + 3_000),
    ]);
    expect(snapshot.servedAt).toBe(iso(BASE_MS));
    expect(snapshot.receivedAtMs).not.toBeNull();

    connections[0]?.push({
      type: "samples",
      stationId: "test-station",
      samples: { intervalSeconds: 3, points: [samplePoint(3), samplePoint(6, 4.1)] },
    });
    await settle();
    snapshot = store.getSnapshot();
    expect(snapshot.samples.map((sample) => sample.observedAt)).toEqual([
      iso(BASE_MS),
      iso(BASE_MS + 3_000),
      iso(BASE_MS + 6_000),
    ]);
    expect(snapshot.samples[2]?.windMps).toBe(4.1);
    store.stop();
  });

  it("carries the sample interval from the wire; absent until a frame states one", async () => {
    const { connections, fetchMock } = connectionQueue();
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationLiveStore("/wind", "test-station");
    store.start();
    await settle();
    expect(store.getSnapshot().sampleIntervalSeconds).toBeNull();

    connections[0]?.push(initFrame([samplePoint(0)]));
    await settle();
    expect(store.getSnapshot().sampleIntervalSeconds).toBe(3);

    connections[0]?.push({
      type: "samples",
      stationId: "test-station",
      samples: { intervalSeconds: 5, points: [samplePoint(6, 4.1)] },
    });
    await settle();
    expect(store.getSnapshot().sampleIntervalSeconds).toBe(5);
    store.stop();
  });

  it("folds reading frames into the seeded station", async () => {
    const { connections, fetchMock } = connectionQueue();
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationLiveStore("/wind", "test-station");
    store.start();
    await settle();
    connections[0]?.push(initFrame([samplePoint(0)]));
    await settle();

    const reading = { ...okStation().reading, windAvgMps: 7.7 };
    connections[0]?.push({
      type: "reading",
      stationId: "test-station",
      servedAt: iso(BASE_MS + 60_000),
      reading,
      telemetry: { batteryVoltage: 4.02 },
    });
    await settle();
    const snapshot = store.getSnapshot();
    expect(snapshot.station?.status === "ok" && snapshot.station.reading.windAvgMps).toBe(7.7);
    expect(snapshot.station?.status === "ok" && snapshot.station.telemetry?.batteryVoltage).toBe(
      4.02,
    );
    expect(snapshot.servedAt).toBe(iso(BASE_MS + 60_000));
    store.stop();
  });

  it("folds summaries frames into the station without disturbing the samples ring", async () => {
    const { connections, fetchMock } = connectionQueue();
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationLiveStore("/wind", "test-station");
    store.start();
    await settle();
    connections[0]?.push(initFrame([samplePoint(0)]));
    await settle();
    const before = store.getSnapshot().samples;

    const block = {
      windowMinutes: 10,
      stepMinutes: 1,
      points: okStation().history?.points.slice(0, 2) ?? [],
    };
    connections[0]?.push({
      type: "summaries",
      stationId: "test-station",
      servedAt: iso(BASE_MS + 90_000),
      summaries: [block],
    });
    await settle();
    const snapshot = store.getSnapshot();
    expect(snapshot.station?.status === "ok" && snapshot.station.recentSummaries).toEqual([block]);
    expect(snapshot.samples).toEqual(before);
    expect(snapshot.servedAt).toBe(iso(BASE_MS + 90_000));
    store.stop();
  });

  it("trims the window and dedupes the overlap a reconnect's init replays", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { connections, fetchMock } = connectionQueue();
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationLiveStore("/wind", "test-station", { windowSeconds: 30 });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    connections[0]?.push(initFrame([samplePoint(0), samplePoint(3)]));
    await vi.advanceTimersByTimeAsync(0);

    connections[0]?.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    connections[1]?.push(initFrame([samplePoint(3), samplePoint(60)]));
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = store.getSnapshot();
    /* 30-second window anchored at the newest sample: the t=0 and t=3
     * points fall away, the deduped t=60 stays once. */
    expect(snapshot.samples.map((sample) => sample.observedAt)).toEqual([iso(BASE_MS + 60_000)]);
    expect(snapshot.status).toBe("open");
    store.stop();
  });

  it("surfaces a contract error and reconnects on an unparseable frame", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { connections, fetchMock } = connectionQueue();
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationLiveStore("/wind", "test-station");
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    connections[0]?.push(initFrame([samplePoint(0)]));
    await vi.advanceTimersByTimeAsync(0);

    connections[0]?.push("not json");
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().error).toEqual({ kind: "contract" });
    /* The station survives the bad frame; only the pipe restarts. */
    expect(store.getSnapshot().station).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    store.stop();
  });

  it("reconnects a silent pipe through the idle watchdog", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { connections, fetchMock } = connectionQueue();
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationLiveStore("/wind", "test-station");
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    connections[0]?.push(initFrame([samplePoint(0)]));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().status).toBe("open");

    /* 60 s of silence aborts the pipe; the init frame reset the attempt, so
     * the next connect lands within the first 1 s backoff step. */
    await vi.advanceTimersByTimeAsync(60_000 + 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    store.stop();
  });

  it("stop tears the connection down and freezes the snapshot", async () => {
    const { connections, fetchMock } = connectionQueue();
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationLiveStore("/wind", "test-station");
    store.start();
    await settle();
    connections[0]?.push(initFrame([samplePoint(0)]));
    await settle();

    store.stop();
    await settle();
    expect(store.getSnapshot().status).toBe("stopped");
    expect(store.getSnapshot().station).not.toBeNull();
    expect(connections[0]?.wasCancelled()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("liveSnapshotToCurrent", () => {
  it("stamps the wire-seen interval onto the rolling window", () => {
    const current = liveSnapshotToCurrent({
      station: { ...okStation(), history: null },
      servedAt: iso(BASE_MS),
      samples: [samplePoint(0)],
      sampleIntervalSeconds: 5,
    });
    expect(current?.station.status === "ok" && current.station.samples).toEqual({
      intervalSeconds: 5,
      points: [samplePoint(0)],
    });
  });

  it("never invents a cadence: with no interval ever seen the samples block stays absent", () => {
    const current = liveSnapshotToCurrent({
      station: { ...okStation(), history: null },
      servedAt: iso(BASE_MS),
      samples: [samplePoint(0)],
      sampleIntervalSeconds: null,
    });
    expect(current?.station.status === "ok" && current.station.samples).toBeUndefined();
  });
});

describe("createStationStore live option", () => {
  it("replaces the current poll with the live stream and folds it into the feed", async () => {
    const { connections, fetchMock } = connectionQueue();
    const feedBody = JSON.stringify(feedFixture());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url.includes("/live")
          ? fetchMock(url, init)
          : ({ ok: true, status: 200, text: async () => feedBody } as Response),
      ),
    );
    const store = createStationStore("/wind", "test-station", { live: true });
    store.start();
    await settle();
    connections[0]?.push(initFrame([samplePoint(0), samplePoint(3)], BASE_MS + 30_000));
    await nextChange(store);
    await settle();

    const snapshot = store.getSnapshot();
    expect(snapshot.station?.id).toBe("test-station");
    expect(snapshot.station?.status === "ok" && snapshot.station.telemetry?.batteryVoltage).toBe(
      4.15,
    );
    expect(
      snapshot.station?.status === "ok" &&
        snapshot.station.samples?.points.map((p) => p.observedAt),
    ).toEqual([iso(BASE_MS), iso(BASE_MS + 3_000)]);
    /* The feed leg's history survives the live fold. */
    expect(snapshot.station?.status === "ok" && snapshot.station.history).not.toBeNull();
    store.stop();
  });
});
