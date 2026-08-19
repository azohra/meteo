import { parseStationClimatologyJson } from "../contract-climatology.js";
import type { StationClimatology } from "../contract-climatology.js";
import type { PollError } from "./poll.js";

const REQUEST_TIMEOUT_MS = 15_000;

export type StationClimatologySnapshot = {
  document: StationClimatology | null;
  receivedAtMs: number | null;
  loading: boolean;
  error: PollError | null;
};

export type StationClimatologyStore = {
  getSnapshot(): StationClimatologySnapshot;
  subscribe(listener: () => void): () => void;
  /** Fetches once; further calls while a document is held are no-ops. */
  load(): Promise<void>;
  /** Forces a refetch — e.g. after the served document's cache lifetime. */
  refresh(): Promise<void>;
};

/**
 * Fetch-once store for the climatology document: near-immutable history
 * needs no poller. Every filter interaction re-aggregates the held cube
 * client-side; only load()/refresh() touch the network.
 */
export function createStationClimatologyStore(
  url: string,
  options: { fetchInit?: RequestInit } = {},
): StationClimatologyStore {
  let snapshot: StationClimatologySnapshot = {
    document: null,
    receivedAtMs: null,
    loading: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const setSnapshot = (next: StationClimatologySnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  let inFlight: Promise<void> | null = null;
  const fetchDocument = async (): Promise<void> => {
    setSnapshot({ ...snapshot, loading: true });
    try {
      const response = await fetch(url, {
        ...options.fetchInit,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        setSnapshot({
          ...snapshot,
          loading: false,
          error: { kind: "network", status: response.status },
        });
        return;
      }
      const document = parseStationClimatologyJson(await response.text());
      if (document == null) {
        setSnapshot({ ...snapshot, loading: false, error: { kind: "contract" } });
        return;
      }
      setSnapshot({ document, receivedAtMs: Date.now(), loading: false, error: null });
    } catch {
      setSnapshot({ ...snapshot, loading: false, error: { kind: "network" } });
    } finally {
      inFlight = null;
    }
  };

  const refresh = (): Promise<void> => {
    inFlight ??= fetchDocument();
    return inFlight;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: () => (snapshot.document != null ? Promise.resolve() : refresh()),
    refresh,
  };
}
