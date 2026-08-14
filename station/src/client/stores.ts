import { stationCurrentSchema, stationFeedSchema } from "../contract.js";
import type { Station, StationCurrent, StationFeed } from "../contract.js";
import { currentEndpoint, feedEndpoint } from "../endpoints.js";
import { foldCurrent } from "../merge-current.js";
import { createStationLiveStore, liveSnapshotToCurrent, type StationLiveSnapshot } from "./live.js";
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

type CurrentLegSnapshot = {
  data: StationCurrent | null;
  error: PollError | null;
  receivedAtMs: number | null;
};

type CurrentLeg = {
  getSnapshot(): CurrentLegSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  refresh(): void;
};

/* The live stream folds into the same seam the current poller uses: its
 * snapshot is shaped into a StationCurrent, with the rolling sample window
 * standing in for the init frame's ring. */
function liveCurrentLeg(
  base: string,
  stationId: string,
  fetchInit: FetchInitOption | undefined,
): CurrentLeg {
  const liveStore = createStationLiveStore(base, stationId, {
    ...(fetchInit != null ? { fetchInit } : {}),
  });
  let lastLive: StationLiveSnapshot | null = null;
  let mapped: CurrentLegSnapshot = { data: null, error: null, receivedAtMs: null };

  const toCurrent = (live: StationLiveSnapshot): CurrentLegSnapshot => {
    const data = liveSnapshotToCurrent(live);
    return {
      data,
      error: live.error,
      receivedAtMs: data == null ? null : live.receivedAtMs,
    };
  };

  return {
    getSnapshot: () => {
      const live = liveStore.getSnapshot();
      if (live !== lastLive) {
        lastLive = live;
        mapped = toCurrent(live);
      }
      return mapped;
    },
    subscribe: (listener) => liveStore.subscribe(listener),
    start: () => liveStore.start(),
    stop: () => liveStore.stop(),
    refresh: () => {
      liveStore.stop();
      liveStore.start();
    },
  };
}

export function createStationStore(
  base: string,
  stationId: string,
  options: {
    pollSeconds?: number;
    currentPollSeconds?: number;
    fetchInit?: FetchInitOption;
    initialData?: { feed: StationFeed; receivedAtMs: number };
    /* Replace the current-poll leg with the /live stream; the feed poll and
     * the fold are unchanged. */
    live?: boolean;
  } = {},
): StationStore {
  const { pollSeconds, currentPollSeconds, fetchInit, initialData } = options;
  const feedStore = createStationFeedStore(base, {
    ...(pollSeconds != null ? { pollSeconds } : {}),
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initialData != null ? { initial: initialData } : {}),
  });
  const currentLeg: CurrentLeg = options.live
    ? liveCurrentLeg(base, stationId, fetchInit)
    : createStationCurrentStore(base, stationId, {
        ...(currentPollSeconds != null ? { pollSeconds: currentPollSeconds } : {}),
        ...(fetchInit != null ? { fetchInit } : {}),
      });

  let cached: StationSnapshot | null = null;
  let lastFeed: ReturnType<typeof feedStore.getSnapshot> | null = null;
  let lastCurrent: CurrentLegSnapshot | null = null;

  return {
    getSnapshot: () => {
      const feedSnapshot = feedStore.getSnapshot();
      const currentSnapshot = currentLeg.getSnapshot();
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
      const unsubscribeCurrent = currentLeg.subscribe(listener);
      return () => {
        unsubscribeFeed();
        unsubscribeCurrent();
      };
    },
    start: () => {
      feedStore.start();
      currentLeg.start();
    },
    stop: () => {
      feedStore.stop();
      currentLeg.stop();
    },
    refresh: () => {
      feedStore.refresh();
      currentLeg.refresh();
    },
  };
}
