"use client";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createJsonPoller } from "../../client/index.js";
import type { ParseOutcome, PollError, PollSeed } from "../../client/index.js";

type PolledState<T> = {
  data: T | null;
  error: PollError | null;
  receivedAtMs: number | null;
};

export function usePoller<S>(
  poller: {
    getSnapshot(): S;
    subscribe(listener: () => void): () => void;
    start(): void;
    stop(): void;
    refresh(): void;
  },
  enabled: boolean,
): { snapshot: S; refresh: () => void } {
  const snapshot = useSyncExternalStore(poller.subscribe, poller.getSnapshot, poller.getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    poller.start();
    return () => poller.stop();
  }, [poller, enabled]);
  const refresh = useCallback(() => poller.refresh(), [poller]);
  return { snapshot, refresh };
}

export function usePolledJson<T>(
  url: string,
  parse: (text: string) => ParseOutcome<T>,
  intervalMsFor: (last: T | null) => number,
  enabled: boolean,
  fetchInit?: RequestInit,
  initial?: PollSeed<T>,
): PolledState<T> & { refresh: () => void } {
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const intervalRef = useRef(intervalMsFor);
  intervalRef.current = intervalMsFor;
  const fetchInitRef = useRef(fetchInit);
  fetchInitRef.current = fetchInit;
  const initialRef = useRef(initial);
  const mountUrlRef = useRef(url);

  const poller = useMemo(
    () =>
      createJsonPoller<T>(url, {
        parse: (text) => parseRef.current(text),
        intervalMsFor: (last) => intervalRef.current(last),
        fetchInit: () => fetchInitRef.current,
        ...(url === mountUrlRef.current && initialRef.current != null
          ? { initial: initialRef.current }
          : {}),
      }),
    [url],
  );

  const { snapshot, refresh } = usePoller(poller, enabled);
  return { ...snapshot, refresh };
}
