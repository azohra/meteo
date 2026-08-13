import { afterEach, describe, expect, it, vi } from "vitest";
import { createJsonPoller } from "../src/client/index.js";
import type { JsonPoller, ParseOutcome } from "../src/client/index.js";

const jsonResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  text: async () => body,
});

const parseNumber = (text: string): ParseOutcome<number> => {
  const value = Number(text);
  return Number.isNaN(value) ? { ok: false, cause: "not a number" } : { ok: true, data: value };
};

const hangingFetch = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );

const nextChange = (poller: JsonPoller<unknown>) =>
  new Promise<void>((resolve) => {
    const unsubscribe = poller.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createJsonPoller", () => {
  it("seeds the snapshot, then the first poll still fires and replaces it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse("42"));
    vi.stubGlobal("fetch", fetchMock);
    const poller = createJsonPoller("/n", {
      parse: parseNumber,
      intervalMsFor: () => 3_600_000,
      initial: { data: 7, receivedAtMs: 111 },
    });
    expect(poller.getSnapshot()).toEqual({ data: 7, error: null, receivedAtMs: 111 });
    poller.start();
    await nextChange(poller);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(poller.getSnapshot().data).toBe(42);
    expect(poller.getSnapshot().receivedAtMs).not.toBe(111);
    poller.stop();
  });

  it("schedules the first interval AFTER the first response, from that response's advice", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse("5"));
    vi.stubGlobal("fetch", fetchMock);
    const poller = createJsonPoller("/n", {
      parse: parseNumber,
      intervalMsFor: (last) => (last ?? 60) * 1_000,
    });
    poller.start();
    await nextChange(poller);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("keeps the last document over a failed poll and flags the structured error", async () => {
    let mode: "ok" | "http" | "body" = "ok";
    const fetchMock = vi.fn(async () =>
      mode === "ok"
        ? jsonResponse("42")
        : mode === "http"
          ? jsonResponse("boom", false)
          : jsonResponse("not-a-number"),
    );
    vi.stubGlobal("fetch", fetchMock);
    const poller = createJsonPoller("/n", {
      parse: parseNumber,
      intervalMsFor: () => 3_600_000,
    });
    poller.start();
    await nextChange(poller);
    const settled = poller.getSnapshot();
    expect(settled.data).toBe(42);

    mode = "http";
    poller.refresh();
    await nextChange(poller);
    expect(poller.getSnapshot().data).toBe(42);
    expect(poller.getSnapshot().error).toEqual({ kind: "network", status: 500 });
    expect(poller.getSnapshot().receivedAtMs).toBe(settled.receivedAtMs);

    mode = "body";
    poller.refresh();
    await nextChange(poller);
    expect(poller.getSnapshot().data).toBe(42);
    expect(poller.getSnapshot().error).toEqual({ kind: "contract", cause: "not a number" });
    poller.stop();
  });

  it("aborts the in-flight request on stop and writes nothing after", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const poller = createJsonPoller("/n", { parse: parseNumber, intervalMsFor: () => 1_000 });
    poller.start();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    poller.stop();
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(poller.getSnapshot().error).toBeNull();
  });

  it("spreads the consumer's fetchInit first so the loop's signal wins", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse("42"));
    vi.stubGlobal("fetch", fetchMock);
    const consumerController = new AbortController();
    const poller = createJsonPoller("/n", {
      parse: parseNumber,
      intervalMsFor: () => 3_600_000,
      fetchInit: { headers: { "x-key": "k" }, signal: consumerController.signal },
    });
    poller.start();
    await nextChange(poller);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual({ "x-key": "k" });
    expect(init.signal).not.toBe(consumerController.signal);
    poller.stop();
  });

  it("reads a function fetchInit per request, so the latest values ride along", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse("42"));
    vi.stubGlobal("fetch", fetchMock);
    let token = "first";
    const poller = createJsonPoller("/n", {
      parse: parseNumber,
      intervalMsFor: () => 3_600_000,
      fetchInit: () => ({ headers: { authorization: token } }),
    });
    poller.start();
    await nextChange(poller);
    token = "second";
    poller.refresh();
    await nextChange(poller);
    const headerOf = (index: number) =>
      (fetchMock.mock.calls[index]![1]!.headers as Record<string, string>).authorization;
    expect(headerOf(0)).toBe("first");
    expect(headerOf(1)).toBe("second");
    poller.stop();
  });

  it("skips ticks while hidden and refetches the moment the page shows", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse("42"));
    vi.stubGlobal("fetch", fetchMock);
    let visibilityHandler: (() => void) | undefined;
    const fakeDocument = {
      hidden: true,
      addEventListener: vi.fn((_type: string, handler: () => void) => {
        visibilityHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", fakeDocument);
    const poller = createJsonPoller("/n", { parse: parseNumber, intervalMsFor: () => 1_000 });
    poller.start();
    await nextChange(poller);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fakeDocument.hidden = false;
    visibilityHandler?.();
    await nextChange(poller);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    poller.stop();
    expect(fakeDocument.removeEventListener).toHaveBeenCalled();
  });

  it("start is idempotent and refresh while stopped is a no-op", async () => {
    const fetchMock = vi.fn(async () => jsonResponse("42"));
    vi.stubGlobal("fetch", fetchMock);
    const poller = createJsonPoller("/n", { parse: parseNumber, intervalMsFor: () => 3_600_000 });
    poller.refresh();
    expect(fetchMock).not.toHaveBeenCalled();
    poller.start();
    poller.start();
    await nextChange(poller);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});
