import { stationCurrentSchema, stationFeedSchema } from "../contract.js";
import type { Station, StationCurrent, StationFeed } from "../contract.js";
import { currentEndpoint, feedEndpoint } from "../endpoints.js";
import { foldCurrent } from "../merge-current.js";
import { createJsonPoller } from "./poll.js";
import type { JsonPoller, ParseOutcome, PollError } from "./poll.js";

const FEED_DEFAULT_POLL_SECONDS = 60;
const CURRENT_DEFAULT_POLL_SECONDS = 15;

export function parseFeedText(text: string): ParseOutcome<StationFeed> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { ok: false, cause };
  }
  const result = stationFeedSchema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, cause: result.error };
}

export function parseCurrentText(text: string): ParseOutcome<StationCurrent> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return { ok: false, cause };
  }
  const result = stationCurrentSchema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, cause: result.error };
}

type FetchInitOption = RequestInit | (() => RequestInit | undefined);

export function createStationFeedStore(
  base: string,
  options: {
    pollSeconds?: number;
    fetchInit?: FetchInitOption;
    initial?: { feed: StationFeed; receivedAtMs: number };
  } = {},
): JsonPoller<StationFeed> {
  const { pollSeconds, fetchInit, initial } = options;
  return createJsonPoller(feedEndpoint(base), {
    parse: parseFeedText,
    intervalMsFor: (last) => {
      if (pollSeconds != null) return pollSeconds * 1_000;
      const advised = last?.stations.map((station) => station.recommendedPollSeconds) ?? [];
      return (advised.length > 0 ? Math.min(...advised) : FEED_DEFAULT_POLL_SECONDS) * 1_000;
    },
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initial != null
      ? { initial: { data: initial.feed, receivedAtMs: initial.receivedAtMs } }
      : {}),
  });
}

export function createStationCurrentStore(
  base: string,
  stationId: string,
  options: {
    pollSeconds?: number;
    fetchInit?: FetchInitOption;
    initial?: { current: StationCurrent; receivedAtMs: number };
  } = {},
): JsonPoller<StationCurrent> {
  const { pollSeconds, fetchInit, initial } = options;
  return createJsonPoller(currentEndpoint(base, stationId), {
    parse: parseCurrentText,
    intervalMsFor: (last) =>
      (pollSeconds ?? last?.station.recommendedPollSeconds ?? CURRENT_DEFAULT_POLL_SECONDS) * 1_000,
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initial != null
      ? { initial: { data: initial.current, receivedAtMs: initial.receivedAtMs } }
      : {}),
  });
}

export type StationSnapshot = {
  feed: StationFeed | null;
  station: Station | null;
  receivedAtMs: number | null;
  error: PollError | null;
};

export type StationStore = {
  getSnapshot(): StationSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  refresh(): void;
};

export function createStationStore(
  base: string,
  stationId: string,
  options: {
    pollSeconds?: number;
    currentPollSeconds?: number;
    fetchInit?: FetchInitOption;
    initialData?: { feed: StationFeed; receivedAtMs: number };
  } = {},
): StationStore {
  const { pollSeconds, currentPollSeconds, fetchInit, initialData } = options;
  const feedStore = createStationFeedStore(base, {
    ...(pollSeconds != null ? { pollSeconds } : {}),
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initialData != null ? { initial: initialData } : {}),
  });
  const currentStore = createStationCurrentStore(base, stationId, {
    ...(currentPollSeconds != null ? { pollSeconds: currentPollSeconds } : {}),
    ...(fetchInit != null ? { fetchInit } : {}),
  });

  let cached: StationSnapshot | null = null;
  let lastFeed: ReturnType<typeof feedStore.getSnapshot> | null = null;
  let lastCurrent: ReturnType<typeof currentStore.getSnapshot> | null = null;

  return {
    getSnapshot: () => {
      const feedSnapshot = feedStore.getSnapshot();
      const currentSnapshot = currentStore.getSnapshot();
      if (cached == null || feedSnapshot !== lastFeed || currentSnapshot !== lastCurrent) {
        lastFeed = feedSnapshot;
        lastCurrent = currentSnapshot;
        const folded = foldCurrent(
          feedSnapshot.data,
          feedSnapshot.receivedAtMs,
          currentSnapshot.data,
          currentSnapshot.receivedAtMs,
        );
        cached = {
          feed: folded.feed,
          station: folded.feed?.stations.find((entry) => entry.id === stationId) ?? null,
          receivedAtMs: folded.receivedAtMs,
          error: feedSnapshot.error ?? currentSnapshot.error,
        };
      }
      return cached;
    },
    subscribe: (listener) => {
      const unsubscribeFeed = feedStore.subscribe(listener);
      const unsubscribeCurrent = currentStore.subscribe(listener);
      return () => {
        unsubscribeFeed();
        unsubscribeCurrent();
      };
    },
    start: () => {
      feedStore.start();
      currentStore.start();
    },
    stop: () => {
      feedStore.stop();
      currentStore.stop();
    },
    refresh: () => {
      feedStore.refresh();
      currentStore.refresh();
    },
  };
}
