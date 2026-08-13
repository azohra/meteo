"use client";
import { useMemo, useRef } from "react";
import { createStationFeedStore } from "../../client/index.js";
import type { PollError } from "../../client/index.js";
import type { StationFeed } from "../../index.js";
import { usePoller } from "./usePolledJson.js";

export function useStationFeed(
  url: string,
  options: {
    pollSeconds?: number;
    enabled?: boolean;
    fetchInit?: RequestInit;
    initialData?: { feed: StationFeed; servedAt?: string; receivedAtMs: number };
  } = {},
): {
  feed: StationFeed | null;
  error: PollError | null;
  receivedAtMs: number | null;
  refresh: () => void;
} {
  const { pollSeconds, enabled = true, fetchInit, initialData } = options;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;
  const initialRef = useRef(initialData);
  const mountUrlRef = useRef(url);

  const store = useMemo(
    () =>
      createStationFeedStore(url, {
        ...(pollSeconds != null ? { pollSeconds } : {}),
        fetchInit: () => fetchInitRef.current,
        ...(url === mountUrlRef.current && initialRef.current != null
          ? {
              initial: {
                feed: initialRef.current.feed,
                receivedAtMs: initialRef.current.receivedAtMs,
              },
            }
          : {}),
      }),
    [url, pollSeconds],
  );
  const { snapshot, refresh } = usePoller(store, enabled);
  return {
    feed: snapshot.data,
    error: snapshot.error,
    receivedAtMs: snapshot.receivedAtMs,
    refresh,
  };
}
