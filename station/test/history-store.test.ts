import { describe, expect, it } from "vitest";
import { createStationHistoryStore } from "../src/client/index.js";
import type { StationHistory } from "../src/index.js";
import { iso, BASE_MS } from "./fixtures.js";

function documentFor(_fromMs: number): StationHistory {
  return {
    schemaVersion: 2,
    servedAt: iso(BASE_MS),
    stationId: "bluff",
    history: { periodMinutes: 60, points: [] },
  };
}

describe("createStationHistoryStore", () => {
  const query = (fromMs: number) => ({ fromMs, toMs: fromMs + 3_600_000, periodMinutes: 60 });

  it("dedupes an in-flight window and cache-serves a revisit", async () => {
    let calls = 0;
    const store = createStationHistoryStore(async (asked) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return documentFor(asked.fromMs);
    });
    const [first, second] = await Promise.all([store.window(query(0)), store.window(query(0))]);
    expect(calls).toBe(1);
    expect(second).toBe(first);
    await store.window(query(0));
    expect(calls).toBe(1);
    await store.window(query(3_600_000));
    expect(calls).toBe(2);
  });

  it("evicts the least recently used window past the budget", async () => {
    const fetched: number[] = [];
    const store = createStationHistoryStore(
      async (asked) => {
        fetched.push(asked.fromMs);
        return documentFor(asked.fromMs);
      },
      { maxWindows: 2 },
    );
    await store.window(query(0));
    await store.window(query(1));
    /* Touch 0 so 1 becomes the eviction candidate, then overflow with 2. */
    await store.window(query(0));
    await store.window(query(2));
    expect(store.size()).toBe(2);
    /* 0 stayed warm; 1 was evicted and refetches. */
    await store.window(query(0));
    await store.window(query(1));
    expect(fetched).toEqual([0, 1, 2, 1]);
  });

  it("never caches a failed fetch, so the next ask retries", async () => {
    let healthy = false;
    let calls = 0;
    const store = createStationHistoryStore(async (asked) => {
      calls += 1;
      return healthy ? documentFor(asked.fromMs) : null;
    });
    expect(await store.window(query(0))).toBeNull();
    healthy = true;
    expect(await store.window(query(0))).not.toBeNull();
    expect(calls).toBe(2);
  });
});
