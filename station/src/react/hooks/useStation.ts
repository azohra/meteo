"use client";
import { useCallback, useMemo } from "react";
import { foldCurrent } from "../../index.js";
import type { Station, StationFeed } from "../../index.js";
import type { PollError } from "../../client/index.js";
import { useStationCurrent } from "./useStationCurrent.js";
import { useStationFeed } from "./useStationFeed.js";

export function useStation(
  url: string,
  stationId: string,
  options: {
    pollSeconds?: number;
    currentPollSeconds?: number;
    enabled?: boolean;
    fetchInit?: RequestInit;
    initialData?: { feed: StationFeed; receivedAtMs: number };
  } = {},
): {
  feed: StationFeed | null;
  station: Station | null;
  receivedAtMs: number | null;
  error: PollError | null;
  refresh: () => void;
} {
  const { pollSeconds, currentPollSeconds, enabled = true, fetchInit, initialData } = options;
  const feedResult = useStationFeed(url, {
    ...(pollSeconds != null ? { pollSeconds } : {}),
    enabled,
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initialData != null ? { initialData } : {}),
  });
  const currentResult = useStationCurrent(url, stationId, {
    ...(currentPollSeconds != null ? { pollSeconds: currentPollSeconds } : {}),
    enabled,
    ...(fetchInit != null ? { fetchInit } : {}),
  });

  const merged = useMemo(
    () =>
      foldCurrent(
        feedResult.feed,
        feedResult.receivedAtMs,
        currentResult.current,
        currentResult.receivedAtMs,
      ),
    [feedResult.feed, feedResult.receivedAtMs, currentResult.current, currentResult.receivedAtMs],
  );

  const station = merged.feed?.stations.find((entry) => entry.id === stationId) ?? null;

  const feedRefresh = feedResult.refresh;
  const currentRefresh = currentResult.refresh;
  const refresh = useCallback(() => {
    feedRefresh();
    currentRefresh();
  }, [feedRefresh, currentRefresh]);

  return {
    feed: merged.feed,
    station,
    receivedAtMs: merged.receivedAtMs,
    error: feedResult.error ?? currentResult.error,
    refresh,
  };
}
