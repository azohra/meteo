// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { climatologyEndpoint } from "../src/index.js";
import { createStationClimatologyStore } from "../src/client/index.js";

const DOCUMENT = {
  schemaVersion: 1,
  servedAt: "2026-08-05T22:13:00.000Z",
  stationId: "bluff",
  sectorCount: 16,
  slotMinutes: 180,
  thresholdsMps: [3, 6, 9],
  utcOffsetMinutes: -480,
  years: [{ year: 2026, sampleCount: 10, expectedCount: 12 }],
  cells: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createStationClimatologyStore", () => {
  it("fetches once: load() after a held document touches no network", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(DOCUMENT), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = createStationClimatologyStore(climatologyEndpoint("/api", "bluff"));
    await store.load();
    await store.load();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])?.[0]).toBe("/api/climatology?station=bluff");
    expect(store.getSnapshot().document?.stationId).toBe("bluff");
    expect(store.getSnapshot().error).toBeNull();

    await store.refresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the held document and surfaces the error when a refresh fails", async () => {
    let healthy = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        healthy
          ? new Response(JSON.stringify(DOCUMENT), { status: 200 })
          : new Response("down", { status: 502 }),
      ),
    );
    const store = createStationClimatologyStore("/api/climatology?station=bluff");
    await store.load();
    healthy = false;
    await store.refresh();
    const snapshot = store.getSnapshot();
    expect(snapshot.document?.stationId).toBe("bluff");
    expect(snapshot.error).toEqual({ kind: "network", status: 502 });
  });

  it("reports a contract error for a document that fails the schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ schemaVersion: 99 }), { status: 200 })),
    );
    const store = createStationClimatologyStore("/api/climatology?station=bluff");
    await store.load();
    expect(store.getSnapshot().document).toBeNull();
    expect(store.getSnapshot().error).toEqual({ kind: "contract" });
  });
});
