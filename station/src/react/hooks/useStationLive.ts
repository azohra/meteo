"use client";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createStationLiveStore } from "../../client/index.js";
import type { LiveStatus, PollError } from "../../client/index.js";
import type { LiveSample, Station } from "../../index.js";

export function useStationLive(
  url: string,
  stationId: string,
  options: {
    enabled?: boolean;
    fetchInit?: RequestInit;
    windowSeconds?: number;
  } = {},
): {
  station: Station | null;
  samples: LiveSample[];
  status: LiveStatus;
  servedAt: string | null;
  receivedAtMs: number | null;
  error: PollError | null;
} {
  const { enabled = true, fetchInit, windowSeconds } = options;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;

  const store = useMemo(
    () =>
      createStationLiveStore(url, stationId, {
        fetchInit: () => fetchInitRef.current,
        ...(windowSeconds != null ? { windowSeconds } : {}),
      }),
    [url, stationId, windowSeconds],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    store.start();
    return () => store.stop();
  }, [store, enabled]);

  return {
    station: snapshot.station,
    samples: snapshot.samples,
    status: snapshot.status,
    servedAt: snapshot.servedAt,
    receivedAtMs: snapshot.receivedAtMs,
    error: snapshot.error,
  };
}
