import { historyEndpoint } from "../endpoints.js";
import { parseStationHistoryJson } from "../contract.js";
import type { StationHistory } from "../contract.js";
import { WINDNERD_RECORD_PERIODS_MINUTES } from "../windnerd.js";
import { REQUEST_TIMEOUT_MS } from "./poll.js";

/* LRU capacity for held windows. Craft parameter (TRIAL), caller-movable. */
export const HISTORY_STORE_DEFAULT_MAX_WINDOWS = 32;

export type StationHistoryQuery = {
  fromMs: number;
  toMs: number;
  periodMinutes: number;
};

/** One requested window in, one parsed document (or null on failure) out.
 * A host that mounts the feed handler uses `stationHistoryFetcher`; a host
 * serving history its own way supplies any function of this shape. */
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

/* Paging math for a host-composed pager: the resolution ladder and
 * calendar-day arithmetic. The library ships no archive control surface. */

/* The default ladder is the WindNerd record catalogue — the vendor home
 * owns the values. The point target is a craft parameter (TRIAL),
 * caller-movable; it bounds one fetch. */
export const ARCHIVE_DEFAULT_PERIODS_MINUTES = WINDNERD_RECORD_PERIODS_MINUTES;
export const ARCHIVE_TARGET_POINTS = 500;

const DAY_MS = 86_400_000;

export type ArchiveWindow = { fromMs: number; toMs: number };

/** The finest ladder period that keeps the span at or under the point
 * target; a span too wide for every rung takes the coarsest. */
export function archivePeriodFor(
  spanMs: number,
  periods: ReadonlyArray<number> = ARCHIVE_DEFAULT_PERIODS_MINUTES,
  targetPoints: number = ARCHIVE_TARGET_POINTS,
): number {
  const ascending = [...periods].sort((left, right) => left - right);
  for (const period of ascending) {
    if (spanMs / (period * 60_000) <= targetPoints) return period;
  }
  return ascending[ascending.length - 1] as number;
}

/** One whole LOCAL day from a YYYY-MM-DD date-input value (not the UTC
 * day); null when the value is not a real date. */
export function archiveDayWindow(dateValue: string): ArchiveWindow | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(year, month - 1, day);
  /* Date() rolls impossible values over into the next month; a rolled-over
   * date was not a real one. */
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) return null;
  return { fromMs: at.getTime(), toMs: at.getTime() + DAY_MS };
}

/** The YYYY-MM-DD value naming an instant's local day. */
export function archiveDayValue(atMs: number): string {
  const at = new Date(atMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The day value deltaDays away. Steps through noon so a DST-shifted
 * midnight cannot skip a day; null for an invalid value. */
export function archiveDayStep(dateValue: string, deltaDays: number): string | null {
  const window = archiveDayWindow(dateValue);
  if (window == null) return null;
  return archiveDayValue(window.fromMs + deltaDays * DAY_MS + DAY_MS / 2);
}

/** The trailing 24 h ending at nowMs. */
export function archiveTrailingWindow(nowMs: number, spanMs = DAY_MS): ArchiveWindow {
  return { fromMs: nowMs - spanMs, toMs: nowMs };
}
