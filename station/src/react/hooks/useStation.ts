"use client";
import { useCallback, useMemo } from "react";
import { foldCurrent } from "../../index.js";
import type { Station, StationFeed } from "../../index.js";
import { liveSnapshotToCurrent } from "../../client/index.js";
import type { PollError } from "../../client/index.js";
import { useStationCurrent } from "./useStationCurrent.js";
import { useStationFeed } from "./useStationFeed.js";
import { useStationLive } from "./useStationLive.js";

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
  const feedResult = useStationFeed(url, {
    ...(pollSeconds != null ? { pollSeconds } : {}),
    enabled,
    ...(fetchInit != null ? { fetchInit } : {}),
    ...(initialData != null ? { initialData } : {}),
  });
  const currentResult = useStationCurrent(url, stationId, {
    ...(currentPollSeconds != null ? { pollSeconds: currentPollSeconds } : {}),
    enabled: enabled && !live,
    ...(fetchInit != null ? { fetchInit } : {}),
  });
  const liveResult = useStationLive(url, stationId, {
    enabled: enabled && live,
    ...(fetchInit != null ? { fetchInit } : {}),
  });

  const liveCurrent = useMemo(
    () =>
      live
        ? liveSnapshotToCurrent({
            station: liveResult.station,
            servedAt: liveResult.servedAt,
            samples: liveResult.samples,
          })
        : null,
    [live, liveResult.station, liveResult.servedAt, liveResult.samples],
  );
  const current = live ? liveCurrent : currentResult.current;
  const currentReceivedAtMs = live
    ? liveCurrent == null
      ? null
      : liveResult.receivedAtMs
    : currentResult.receivedAtMs;
  const currentError = live ? liveResult.error : currentResult.error;

  const merged = useMemo(
    () => foldCurrent(feedResult.feed, feedResult.receivedAtMs, current, currentReceivedAtMs),
    [feedResult.feed, feedResult.receivedAtMs, current, currentReceivedAtMs],
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
    error: feedResult.error ?? currentError,
    refresh,
  };
}
