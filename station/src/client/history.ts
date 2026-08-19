import { historyEndpoint } from "../endpoints.js";
import { parseStationHistoryJson } from "../contract.js";
import type { StationHistory } from "../contract.js";

const REQUEST_TIMEOUT_MS = 15_000;
/* Windows a browsing session keeps warm; the oldest fall away. A craft
 * parameter (TRIAL), caller-movable. */
export const HISTORY_STORE_DEFAULT_MAX_WINDOWS = 32;

export type StationHistoryQuery = {
  fromMs: number;
  toMs: number;
  periodMinutes: number;
};

/**
 * The archive components' data contract: one requested window in, one
 * parsed document (or null on failure) out. A host that mounts the feed
 * handler uses `stationHistoryFetcher`; one that serves history its own way
 * — an authenticated server function, a proxy — supplies any function of
 * this shape and never touches the handler.
 */
export type StationHistoryFetcher = (query: StationHistoryQuery) => Promise<StationHistory | null>;

/** The default fetcher, against the mounted handler's /history route. */
export function stationHistoryFetcher(
  base: string,
  stationId: string,
  fetchInit?: RequestInit,
): StationHistoryFetcher {
  return async (query) => {
    try {
      const response = await fetch(historyEndpoint(base, stationId, query), {
        ...fetchInit,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return parseStationHistoryJson(await response.text());
    } catch {
      return null;
    }
  };
}

export type StationHistoryStore = {
  /** The window's document — cache-served when held, deduplicated while in
   * flight. A failed fetch resolves null and is not cached, so the next
   * ask retries. */
  window(query: StationHistoryQuery): Promise<StationHistory | null>;
  /** Windows currently held. */
  size(): number;
};

/** A window-keyed LRU over a fetcher, so pan/zoom revisits cost nothing. */
export function createStationHistoryStore(
  fetcher: StationHistoryFetcher,
  options: { maxWindows?: number } = {},
): StationHistoryStore {
  const maxWindows = options.maxWindows ?? HISTORY_STORE_DEFAULT_MAX_WINDOWS;
  const held = new Map<string, StationHistory>();
  const inFlight = new Map<string, Promise<StationHistory | null>>();
  const keyOf = (query: StationHistoryQuery) =>
    `${query.fromMs}/${query.toMs}/${query.periodMinutes}`;

  return {
    window: (query) => {
      const key = keyOf(query);
      const cached = held.get(key);
      if (cached != null) {
        /* Re-insert for LRU recency. */
        held.delete(key);
        held.set(key, cached);
        return Promise.resolve(cached);
      }
      const pending = inFlight.get(key);
      if (pending != null) return pending;
      const request = fetcher(query)
        .then((document) => {
          if (document != null) {
            held.set(key, document);
            while (held.size > maxWindows) {
              const oldest = held.keys().next().value;
              if (oldest == null) break;
              held.delete(oldest);
            }
          }
          return document;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, request);
      return request;
    },
    size: () => held.size,
  };
}
