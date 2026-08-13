import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStationCurrentStore,
  createStationFeedStore,
  createStationStore,
} from "../src/client/index.js";
import type { StationStore } from "../src/client/index.js";
import { BASE_MS, downStation, feedFixture, iso, okStation } from "./fixtures.js";

const jsonResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  text: async () => body,
});

const nextChange = (store: StationStore | { subscribe(l: () => void): () => void }) =>
  new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });

const currentBody = (station: unknown, servedAtMs: number) =>
  JSON.stringify({ schemaVersion: 2, servedAt: iso(servedAtMs), station });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createStationFeedStore", () => {
  it("polls the /feed route at the fastest advised cadence", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string) => jsonResponse(JSON.stringify(feedFixture())));
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationFeedStore("/wind/");
    store.start();
    await nextChange(store);
    await Promise.resolve();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/wind/feed");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    store.stop();
  });
});

describe("createStationCurrentStore", () => {
  it("polls the /current route at the station's own cadence", async () => {
    vi.useFakeTimers();
    const body = currentBody({ ...okStation(), history: null }, BASE_MS + 1_000);
    const fetchMock = vi.fn(async (_url: string) => jsonResponse(body));
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationCurrentStore("/wind", "test-station");
    store.start();
    await nextChange(store);
    await Promise.resolve();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/wind/current?station=test-station");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    store.stop();
  });
});

describe("createStationStore", () => {
  const routed = (feedBody: string, currentBodyText: string) =>
    vi.fn(async (url: string) =>
      url.includes("/feed") ? jsonResponse(feedBody) : jsonResponse(currentBodyText),
    );

  it("folds the current into the feed and takes the current's clock when merged", async () => {
    vi.setSystemTime(BASE_MS);
    const fresh = {
      ...okStation(),
      reading: { ...okStation().reading, observedAt: iso(BASE_MS + 30_000), windAvgMps: 9.9 },
      history: null,
    };
    const fetchMock = routed(JSON.stringify(feedFixture()), currentBody(fresh, BASE_MS + 30_000));
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationStore("/wind", "test-station", {
      pollSeconds: 86_400,
      currentPollSeconds: 86_400,
    });
    store.start();
    await vi.waitFor(() => {
      expect(store.getSnapshot().feed).not.toBeNull();
      expect(store.getSnapshot().station?.reading?.windAvgMps).toBe(9.9);
    });
    const snapshot = store.getSnapshot();
    expect(store.getSnapshot()).toBe(snapshot);
    expect(snapshot.station?.id).toBe("test-station");
    store.stop();
  });

  it("keeps the feed's own clock when the current does not merge", async () => {
    const fetchMock = routed(
      JSON.stringify(feedFixture()),
      currentBody({ ...downStation(), id: "test-station" }, BASE_MS + 30_000),
    );
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationStore("/wind", "test-station", {
      pollSeconds: 86_400,
      currentPollSeconds: 86_400,
    });
    store.start();
    await vi.waitFor(() => expect(store.getSnapshot().feed).not.toBeNull());
    const snapshot = store.getSnapshot();
    expect(snapshot.station?.reading?.windAvgMps).toBeCloseTo(18.4 / 3.6, 10);
    expect(snapshot.receivedAtMs).not.toBeNull();
    store.stop();
  });

  it("lets the feed's error outrank the current's and refreshes both", async () => {
    let feedFails = true;
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/feed")
        ? feedFails
          ? jsonResponse("boom", false)
          : jsonResponse(JSON.stringify(feedFixture()))
        : jsonResponse("also-broken"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationStore("/wind", "test-station", {
      pollSeconds: 86_400,
      currentPollSeconds: 86_400,
    });
    store.start();
    await vi.waitFor(() => expect(store.getSnapshot().error).not.toBeNull());
    expect(store.getSnapshot().error).toEqual({ kind: "network", status: 500 });

    feedFails = false;
    const callsBefore = fetchMock.mock.calls.length;
    store.refresh();
    await vi.waitFor(() => expect(store.getSnapshot().feed).not.toBeNull());
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(callsBefore + 2);
    expect(store.getSnapshot().error?.kind).toBe("contract");
    store.stop();
  });
});
