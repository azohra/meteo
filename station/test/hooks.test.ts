// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useMeasuredChartWidth,
  useStation,
  useStationFeed,
  useStationLive,
} from "../src/react/index.js";
import { CHART_FALLBACK_WIDTH } from "../src/index.js";
import { BASE_MS, downStation, feedFixture, iso, okStation } from "./fixtures.js";

const jsonResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  text: async () => body,
});

const hangingFetch = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );

const signalOfCall = (fetchMock: ReturnType<typeof vi.fn>, index: number) =>
  (fetchMock.mock.calls[index]?.[1] as RequestInit | undefined)?.signal;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useStationFeed", () => {
  it("builds /feed off the mount base, loads immediately, keeps the last feed on errors", async () => {
    const feedBody = JSON.stringify(feedFixture());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(feedBody));
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useStationFeed("/wind", { pollSeconds: 86_400 }));
    await waitFor(() => expect(result.current.feed).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.receivedAtMs).not.toBeNull();
    expect(result.current.feed?.stations.length).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "/wind/feed",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    fetchMock.mockRejectedValue(new Error("down"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toEqual({ kind: "network" }));
    expect(result.current.feed?.stations.length).toBe(2);

    fetchMock.mockResolvedValue(jsonResponse('{"not":"a feed"}'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error?.kind).toBe("contract"));
    expect(result.current.error?.kind === "contract" && result.current.error.cause).toHaveProperty(
      "issues",
    );
    expect(result.current.feed?.stations.length).toBe(2);
    unmount();
  });

  it("carries the HTTP status on a non-ok response and the syntax error on unparseable JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse("upstream broke", false));
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useStationFeed("/wind", { pollSeconds: 86_400 }));
    await waitFor(() => expect(result.current.error).toEqual({ kind: "network", status: 500 }));

    fetchMock.mockResolvedValue(jsonResponse("not json at all"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error?.kind).toBe("contract"));
    expect(result.current.error?.kind === "contract" && result.current.error.cause).toBeInstanceOf(
      SyntaxError,
    );
    unmount();
  });

  it("does not fetch when disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() => useStationFeed("/wind", { enabled: false }));
    expect(result.current.feed).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it("aborts the in-flight request on unmount", () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderHook(() => useStationFeed("/wind", { pollSeconds: 86_400 }));
    const signal = signalOfCall(fetchMock, 0);
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("on url change: aborts the stalled request and fetches the new url unsuppressed", async () => {
    const feedBody = JSON.stringify(feedFixture([okStation()]));
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/a/feed") {
        return new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(jsonResponse(feedBody));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender, unmount } = renderHook(
      ({ url }) => useStationFeed(url, { pollSeconds: 86_400 }),
      { initialProps: { url: "/a" } },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ url: "/b" });
    expect(signalOfCall(fetchMock, 0)?.aborted).toBe(true);
    await waitFor(() => expect(result.current.feed?.stations.length).toBe(1));
    expect(fetchMock).toHaveBeenLastCalledWith("/b/feed", expect.anything());
    unmount();
  });

  it("on url change: drops the old url's data instead of serving it under the new address", async () => {
    const feedBody = JSON.stringify(feedFixture());
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/a/feed") return Promise.resolve(jsonResponse(feedBody));
      return new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender, unmount } = renderHook(
      ({ url }) => useStationFeed(url, { pollSeconds: 86_400 }),
      { initialProps: { url: "/a" } },
    );
    await waitFor(() => expect(result.current.feed?.stations.length).toBe(2));
    rerender({ url: "/b" });
    expect(result.current.feed).toBeNull();
    expect(result.current.receivedAtMs).toBeNull();
    unmount();
  });

  it("schedules the first interval from the first response's advised cadence", async () => {
    vi.useFakeTimers();
    const feedBody = JSON.stringify(feedFixture());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(feedBody));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderHook(() => useStationFeed("/wind"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("paints seeded initialData before any fetch resolves, and still fires the first poll", async () => {
    const seeded = feedFixture();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() =>
      useStationFeed("/wind", {
        pollSeconds: 86_400,
        initialData: { feed: seeded, receivedAtMs: BASE_MS + 30_000 },
      }),
    );
    expect(result.current.feed?.stations.length).toBe(2);
    expect(result.current.receivedAtMs).toBe(BASE_MS + 30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("merges fetchInit into the poll fetch, but its own abort signal wins", async () => {
    const feedBody = JSON.stringify(feedFixture());
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(feedBody));
    vi.stubGlobal("fetch", fetchMock);
    const consumerController = new AbortController();

    const { result, unmount } = renderHook(() =>
      useStationFeed("/wind", {
        pollSeconds: 86_400,
        fetchInit: {
          cache: "no-store",
          headers: { authorization: "Bearer demo" },
          signal: consumerController.signal,
        },
      }),
    );
    await waitFor(() => expect(result.current.feed).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/wind/feed",
      expect.objectContaining({
        cache: "no-store",
        headers: { authorization: "Bearer demo" },
      }),
    );
    const carried = signalOfCall(fetchMock, 0);
    expect(carried).not.toBe(consumerController.signal);
    unmount();
  });

  it("abandons a stalled request at the deadline and keeps polling", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useStationFeed("/wind"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_100);
    });
    expect(signalOfCall(fetchMock, 0)?.aborted).toBe(true);
    expect(result.current.error).toEqual({ kind: "network" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe("useStation", () => {
  const currentBody = (station: unknown, servedAtMs: number) =>
    JSON.stringify({ schemaVersion: 2, servedAt: iso(servedAtMs), station });

  it("polls both routes off one mount base, merges current into the feed, applies the clock rule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
    const feedBody = JSON.stringify(feedFixture());
    let current = currentBody({ ...downStation(), id: "test-station" }, BASE_MS + 1_000);
    const fetchMock = vi.fn((url: string) => {
      if (url === "/wind/feed") return Promise.resolve(jsonResponse(feedBody));
      if (url === "/wind/current?station=test-station") {
        return Promise.resolve(jsonResponse(current));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() =>
      useStation("/wind", "test-station", { pollSeconds: 86_400, currentPollSeconds: 30 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledWith("/wind/feed", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("/wind/current?station=test-station", expect.anything());
    expect(result.current.station?.status).toBe("ok");
    expect(result.current.station?.reading?.windAvgMps).toBeCloseTo(18.4 / 3.6);
    expect(result.current.receivedAtMs).toBe(BASE_MS);
    expect(result.current.error).toBeNull();

    current = currentBody(
      {
        ...okStation(),
        reading: { ...okStation().reading, observedAt: iso(BASE_MS + 30_000), windAvgMps: 9.9 },
        history: null,
      },
      BASE_MS + 30_000,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_100);
    });
    expect(result.current.station?.reading?.windAvgMps).toBe(9.9);
    expect(result.current.feed?.stations[0]?.history?.points.length).toBe(12);
    expect(result.current.receivedAtMs).toBeGreaterThanOrEqual(BASE_MS + 30_000);
    unmount();
  });

  it("refresh refreshes both endpoints", async () => {
    const feedBody = JSON.stringify(feedFixture());
    const okCurrent = currentBody({ ...okStation(), history: null }, BASE_MS + 1_000);
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(jsonResponse(url === "/wind/feed" ? feedBody : okCurrent)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() =>
      useStation("/wind", "test-station", { pollSeconds: 86_400, currentPollSeconds: 86_400 }),
    );
    await waitFor(() => expect(result.current.feed).not.toBeNull());
    const callsBefore = fetchMock.mock.calls.length;
    act(() => result.current.refresh());
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(callsBefore + 2));
    unmount();
  });
});

describe("useMeasuredChartWidth", () => {
  class MockResizeObserver {
    static instances: MockResizeObserver[] = [];
    observed: Element[] = [];
    disconnected = false;
    readonly #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
      MockResizeObserver.instances.push(this);
    }
    observe(element: Element) {
      this.observed.push(element);
    }
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
    report(width: number) {
      act(() =>
        this.#callback(
          [{ contentRect: { width } }] as unknown as ResizeObserverEntry[],
          this as unknown as ResizeObserver,
        ),
      );
    }
  }

  const container = (clientWidth = 0) => {
    const element = document.createElement("div");
    Object.defineProperty(element, "clientWidth", { value: clientWidth, configurable: true });
    return element;
  };

  afterEach(() => {
    MockResizeObserver.instances = [];
  });

  it("holds null until measured, then frames at the observed width", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const { result, unmount } = renderHook(() => useMeasuredChartWidth({ current: container() }));
    expect(result.current).toBeNull();

    const observer = MockResizeObserver.instances[0];
    observer?.report(480.4);
    expect(result.current).toBe(480);
    unmount();
    expect(observer?.disconnected).toBe(true);
  });

  it("reads the container synchronously on mount, before any observation arrives", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const { result, unmount } = renderHook(() =>
      useMeasuredChartWidth({ current: container(420) }),
    );
    expect(result.current).toBe(420);
    unmount();
  });

  it("ignores zero-width observations: stays held, then keeps the last real width", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const { result, unmount } = renderHook(() => useMeasuredChartWidth({ current: container() }));

    const observer = MockResizeObserver.instances[0];
    observer?.report(0);
    expect(result.current).toBeNull();
    observer?.report(320);
    expect(result.current).toBe(320);
    observer?.report(0);
    expect(result.current).toBe(320);
    unmount();
  });

  it("applies the fallback width when ResizeObserver is unavailable", () => {
    expect(typeof ResizeObserver).toBe("undefined");
    const { result, unmount } = renderHook(() =>
      useMeasuredChartWidth({ current: container(420) }),
    );
    expect(result.current).toBe(CHART_FALLBACK_WIDTH);
    unmount();
  });

  it("enabled: false skips observing entirely", () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const { result, unmount } = renderHook(() =>
      useMeasuredChartWidth({ current: container(420) }, { enabled: false }),
    );
    expect(result.current).toBeNull();
    expect(MockResizeObserver.instances).toHaveLength(0);
    unmount();
  });
});

describe("useStationLive", () => {
  const encoder = new TextEncoder();

  function liveConnection() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    return {
      response: new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      push(frame: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      },
    };
  }

  const liveInitFrame = () => ({
    type: "init",
    schemaVersion: 2,
    servedAt: iso(BASE_MS),
    station: {
      ...okStation(),
      history: null,
      telemetry: { batteryVoltage: 4.15 },
      samples: {
        intervalSeconds: 3,
        points: [{ observedAt: iso(BASE_MS), windMps: 2.5, windDirectionDeg: 270 }],
      },
    },
  });

  it("seeds from the init frame and folds later sample batches", async () => {
    const connection = liveConnection();
    const fetchMock = vi.fn().mockResolvedValue(connection.response);
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useStationLive("/wind", "test-station"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/wind/live?station=test-station");

    connection.push(liveInitFrame());
    await waitFor(() => expect(result.current.station).not.toBeNull());
    expect(result.current.status).toBe("open");
    expect(result.current.samples).toHaveLength(1);
    expect(result.current.station?.status === "ok" && result.current.station.telemetry).toEqual({
      batteryVoltage: 4.15,
    });

    connection.push({
      type: "samples",
      stationId: "test-station",
      samples: {
        intervalSeconds: 3,
        points: [{ observedAt: iso(BASE_MS + 3_000), windMps: 3.1, windDirectionDeg: 280 }],
      },
    });
    await waitFor(() => expect(result.current.samples).toHaveLength(2));
    unmount();
  });

  it("useStation live replaces the current poll with the stream and folds it into the feed", async () => {
    const connection = liveConnection();
    const feedBody = JSON.stringify(feedFixture());
    const currentCalls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/live")) return connection.response;
      if (url.includes("/current")) {
        currentCalls.push(url);
        throw new Error("current poll must stay off in live mode");
      }
      return jsonResponse(feedBody) as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() =>
      useStation("/wind", "test-station", { live: true, pollSeconds: 86_400 }),
    );
    await waitFor(() => expect(result.current.feed).not.toBeNull());

    connection.push(liveInitFrame());
    await waitFor(() =>
      expect(
        result.current.station?.status === "ok" && result.current.station.telemetry?.batteryVoltage,
      ).toBe(4.15),
    );
    /* The feed leg's history survives the live fold. */
    expect(
      result.current.station?.status === "ok" && result.current.station.history,
    ).not.toBeNull();
    expect(currentCalls).toEqual([]);
    unmount();
  });
});
