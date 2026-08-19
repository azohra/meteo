"use client";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createStationClimatologyStore } from "../../client/index.js";
import type { PollError } from "../../client/index.js";
import { climatologyEndpoint } from "../../index.js";
import type { StationClimatology } from "../../index.js";

/** Fetches the station's climatology document once and holds it — near-
 * immutable history needs no poller; filters re-aggregate client-side. */
export function useStationClimatology(
  base: string,
  stationId: string,
  options: { enabled?: boolean; fetchInit?: RequestInit } = {},
): {
  document: StationClimatology | null;
  loading: boolean;
  error: PollError | null;
  refresh: () => void;
} {
  const { enabled = true, fetchInit } = options;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;

  const store = useMemo(
    () =>
      createStationClimatologyStore(climatologyEndpoint(base, stationId), {
        fetchInit: fetchInitRef.current,
      }),
    [base, stationId],
  );
  useEffect(() => {
    if (enabled) void store.load();
  }, [store, enabled]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    document: snapshot.document,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh: () => void store.refresh(),
  };
}
