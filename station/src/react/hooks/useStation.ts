"use client";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createStationStore } from "../../client/index.js";
import type { PollError } from "../../client/index.js";
import type { Station, StationFeed } from "../../index.js";

export function useStation(
  url: string,
  stationId: string,
  options: {
    pollSeconds?: number;
    currentPollSeconds?: number;
    enabled?: boolean;
    fetchInit?: RequestInit;
    initialData?: { feed: StationFeed; receivedAtMs: number };
    /* Replace the current-poll leg with the /live stream; the feed poll and
     * the fold are unchanged. */
    live?: boolean;
  } = {},
): {
  feed: StationFeed | null;
  station: Station | null;
  receivedAtMs: number | null;
  error: PollError | null;
  refresh: () => void;
} {
  const { pollSeconds, currentPollSeconds, enabled = true, fetchInit, initialData } = options;
  const live = options.live === true;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;
  const initialRef = useRef(initialData);
  const mountUrlRef = useRef(url);

  const store = useMemo(
    () =>
      createStationStore(url, stationId, {
        ...(pollSeconds != null ? { pollSeconds } : {}),
        ...(currentPollSeconds != null ? { currentPollSeconds } : {}),
        fetchInit: () => fetchInitRef.current,
        ...(url === mountUrlRef.current && initialRef.current != null
          ? { initialData: initialRef.current }
          : {}),
        live,
      }),
    [url, stationId, pollSeconds, currentPollSeconds, live],
  );
  useEffect(() => {
    if (!enabled) return;
    store.start();
    return () => store.stop();
  }, [store, enabled]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    feed: snapshot.feed,
    station: snapshot.station,
    receivedAtMs: snapshot.receivedAtMs,
    error: snapshot.error,
    refresh: () => store.refresh(),
  };
}
