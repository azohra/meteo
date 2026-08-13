"use client";
import { useMemo, useRef } from "react";
import { createStationCurrentStore } from "../../client/index.js";
import type { PollError } from "../../client/index.js";
import type { Station, StationCurrent } from "../../index.js";
import { usePoller } from "./usePolledJson.js";

export function useStationCurrent(
  url: string,
  stationId: string,
  options: {
    pollSeconds?: number;
    enabled?: boolean;
    fetchInit?: RequestInit;
    initialData?: { current: StationCurrent; receivedAtMs: number };
  } = {},
): {
  current: StationCurrent | null;
  station: Station | null;
  servedAt: string | null;
  error: PollError | null;
  receivedAtMs: number | null;
  refresh: () => void;
} {
  const { pollSeconds, enabled = true, fetchInit, initialData } = options;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;
  const initialRef = useRef(initialData);
  const mountUrlRef = useRef(url);
  const mountStationRef = useRef(stationId);

  const store = useMemo(
    () =>
      createStationCurrentStore(url, stationId, {
        ...(pollSeconds != null ? { pollSeconds } : {}),
        fetchInit: () => fetchInitRef.current,
        ...(url === mountUrlRef.current &&
        stationId === mountStationRef.current &&
        initialRef.current != null
          ? { initial: initialRef.current }
          : {}),
      }),
    [url, stationId, pollSeconds],
  );
  const { snapshot, refresh } = usePoller(store, enabled);
  return {
    current: snapshot.data,
    station: snapshot.data?.station ?? null,
    servedAt: snapshot.data?.servedAt ?? null,
    error: snapshot.error,
    receivedAtMs: snapshot.receivedAtMs,
    refresh,
  };
}
