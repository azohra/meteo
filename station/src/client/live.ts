import {
  parseStationLiveFrameJson,
  STATION_SCHEMA_VERSION,
  type LiveSample,
  type Station,
  type StationCurrent,
  type StationLiveFrame,
} from "../contract.js";
import { liveEndpoint } from "../endpoints.js";
import { sseEvents } from "../sse.js";
import type { PollError } from "./poll.js";

export const LIVE_BACKOFF_MIN_MS = 1_000;
export const LIVE_BACKOFF_MAX_MS = 30_000;
/* No frame — not even a ping — for this long means the pipe is dead. */
export const LIVE_IDLE_RECONNECT_MS = 60_000;
const DEFAULT_WINDOW_SECONDS = 600;

export type LiveStatus = "connecting" | "open" | "backoff" | "stopped";

export type StationLiveSnapshot = {
  status: LiveStatus;
  /* Seeded by the init frame, refreshed in place by reading frames. */
  station: Station | null;
  /* Rolling sample window, oldest first, deduplicated by observedAt. */
  samples: LiveSample[];
  /* Seconds between samples, from the last frame that carried a samples
   * block; null until one has — the wire owns the cadence, never a client
   * default. */
  sampleIntervalSeconds: number | null;
  /* The server clock of the last frame that carried one. */
  servedAt: string | null;
  receivedAtMs: number | null;
  error: PollError | null;
};

export type StationLiveStore = {
  getSnapshot(): StationLiveSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
};

type FetchInitOption = RequestInit | (() => RequestInit | undefined);

type Session = {
  disposed: boolean;
  controller: AbortController | null;
  attempt: number;
  wake: (() => void) | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  onVisibilityChange: () => void;
};

/**
 * Subscribes to the /live route and folds its frames into one snapshot. The
 * store owns the reconnect loop — exponential backoff from 1 s capped at
 * 30 s with full jitter, reset by a successful init frame — and an idle
 * watchdog that forces a reconnect on a silent pipe. Hidden documents
 * disconnect and reconnect on return; a reconnect's fresh init frame heals
 * any gap the ring can cover.
 */
export function createStationLiveStore(
  base: string,
  stationId: string,
  options: {
    fetchInit?: FetchInitOption;
    windowSeconds?: number;
  } = {},
): StationLiveStore {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const fetchInitFor = (): RequestInit | undefined =>
    typeof options.fetchInit === "function" ? options.fetchInit() : options.fetchInit;

  let snapshot: StationLiveSnapshot = {
    status: "stopped",
    station: null,
    samples: [],
    sampleIntervalSeconds: null,
    servedAt: null,
    receivedAtMs: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  let session: Session | null = null;

  const setSnapshot = (next: StationLiveSnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const hidden = () => typeof document !== "undefined" && document.hidden;

  const applyFrame = (frame: StationLiveFrame, current: Session): void => {
    switch (frame.type) {
      case "init": {
        current.attempt = 0;
        const ring = frame.station.status === "ok" ? (frame.station.samples ?? null) : null;
        setSnapshot({
          status: "open",
          station: frame.station,
          samples: mergeSamples(snapshot.samples, ring?.points ?? [], windowSeconds),
          sampleIntervalSeconds: ring?.intervalSeconds ?? snapshot.sampleIntervalSeconds,
          servedAt: frame.servedAt,
          receivedAtMs: Date.now(),
          error: null,
        });
        return;
      }
      case "samples":
        setSnapshot({
          ...snapshot,
          status: "open",
          samples: mergeSamples(snapshot.samples, frame.samples.points, windowSeconds),
          sampleIntervalSeconds: frame.samples.intervalSeconds,
          receivedAtMs: Date.now(),
          error: null,
        });
        return;
      case "reading": {
        const station = snapshot.station;
        setSnapshot({
          ...snapshot,
          status: "open",
          station:
            station?.status === "ok"
              ? { ...station, reading: frame.reading, telemetry: frame.telemetry }
              : station,
          servedAt: frame.servedAt,
          receivedAtMs: Date.now(),
          error: null,
        });
        return;
      }
      case "summaries": {
        const station = snapshot.station;
        setSnapshot({
          ...snapshot,
          status: "open",
          station:
            station?.status === "ok" ? { ...station, recentSummaries: frame.summaries } : station,
          servedAt: frame.servedAt,
          receivedAtMs: Date.now(),
          error: null,
        });
        return;
      }
      case "ping":
        /* Fed the idle watchdog by arriving; the snapshot has nothing new. */
        return;
      case "unavailable":
        /* Terminal — the server closes after it; the loop reconnects. The
         * last station stays and ages visibly rather than vanishing. */
        setSnapshot({ ...snapshot, error: { kind: "network" } });
        return;
    }
  };

  const connect = async (current: Session): Promise<void> => {
    const controller = new AbortController();
    current.controller = controller;
    setSnapshot({ ...snapshot, status: "connecting" });
    const resetIdle = () => {
      if (current.idleTimer != null) clearTimeout(current.idleTimer);
      current.idleTimer = setTimeout(() => controller.abort(), LIVE_IDLE_RECONNECT_MS);
    };
    try {
      /* Armed before the request so a hung connect reconnects too. */
      resetIdle();
      const response = await fetch(liveEndpoint(base, stationId), {
        ...fetchInitFor(),
        signal: controller.signal,
      });
      if (!response.ok || response.body == null) {
        await response.body?.cancel();
        if (!current.disposed) {
          setSnapshot({ ...snapshot, error: { kind: "network", status: response.status } });
        }
        return;
      }
      resetIdle();
      for await (const event of sseEvents(response.body, { signal: controller.signal })) {
        if (current.disposed) return;
        resetIdle();
        const frame = parseStationLiveFrameJson(event.data);
        if (frame == null) {
          setSnapshot({ ...snapshot, error: { kind: "contract" } });
          return; /* reconnect for a clean init */
        }
        applyFrame(frame, current);
      }
      /* Server closed the stream; the loop reconnects. */
    } catch {
      if (!current.disposed) setSnapshot({ ...snapshot, error: { kind: "network" } });
    } finally {
      if (current.idleTimer != null) clearTimeout(current.idleTimer);
      current.idleTimer = undefined;
      controller.abort();
      if (current.controller === controller) current.controller = null;
    }
  };

  const sleep = (current: Session, delayMs: number): Promise<void> =>
    new Promise((resolve) => {
      current.wake = () => {
        current.wake = null;
        if (current.timer != null) clearTimeout(current.timer);
        current.timer = undefined;
        resolve();
      };
      current.timer = setTimeout(() => current.wake?.(), delayMs);
    });

  const runLoop = async (current: Session): Promise<void> => {
    while (!current.disposed) {
      if (hidden()) {
        setSnapshot({ ...snapshot, status: "backoff" });
        await sleep(current, LIVE_BACKOFF_MAX_MS);
        continue;
      }
      await connect(current);
      if (current.disposed) return;
      setSnapshot({ ...snapshot, status: "backoff" });
      const delay = backoffDelayMs(current.attempt);
      current.attempt += 1;
      await sleep(current, delay);
    }
  };

  const start = () => {
    if (session != null) return;
    const current: Session = {
      disposed: false,
      controller: null,
      attempt: 0,
      wake: null,
      timer: undefined,
      idleTimer: undefined,
      onVisibilityChange: () => {
        if (hidden()) {
          current.controller?.abort();
        } else {
          current.wake?.();
        }
      },
    };
    session = current;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", current.onVisibilityChange);
    }
    void runLoop(current);
  };

  const stop = () => {
    const current = session;
    if (current == null) return;
    session = null;
    current.disposed = true;
    current.controller?.abort();
    current.wake?.();
    if (current.timer != null) clearTimeout(current.timer);
    if (current.idleTimer != null) clearTimeout(current.idleTimer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", current.onVisibilityChange);
    }
    setSnapshot({ ...snapshot, status: "stopped" });
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    stop,
  };
}

/* Shapes a live snapshot into the current document the fold understands,
 * with the rolling sample window standing in for the init frame's ring.
 * Without a wire-seen interval the station keeps its own samples block
 * as-is — the cadence is never invented client-side. */
export function liveSnapshotToCurrent(
  live: Pick<StationLiveSnapshot, "station" | "servedAt" | "samples" | "sampleIntervalSeconds">,
): StationCurrent | null {
  if (live.station == null || live.servedAt == null) return null;
  const station =
    live.station.status === "ok" && live.samples.length > 0 && live.sampleIntervalSeconds != null
      ? {
          ...live.station,
          samples: {
            intervalSeconds: live.sampleIntervalSeconds,
            points: live.samples,
          },
        }
      : live.station;
  return { schemaVersion: STATION_SCHEMA_VERSION, servedAt: live.servedAt, station };
}

function backoffDelayMs(attempt: number): number {
  const ceiling = Math.min(LIVE_BACKOFF_MAX_MS, LIVE_BACKOFF_MIN_MS * 2 ** attempt);
  return Math.random() * ceiling;
}

function mergeSamples(
  existing: readonly LiveSample[],
  incoming: readonly LiveSample[],
  windowSeconds: number,
): LiveSample[] {
  const byObservedAt = new Map<string, LiveSample>();
  for (const sample of existing) byObservedAt.set(sample.observedAt, sample);
  for (const sample of incoming) byObservedAt.set(sample.observedAt, sample);
  const merged = [...byObservedAt.values()].sort(
    (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
  );
  const latest = merged[merged.length - 1];
  if (latest == null) return merged;
  const cutoffMs = Date.parse(latest.observedAt) - windowSeconds * 1_000;
  return merged.filter((sample) => Date.parse(sample.observedAt) >= cutoffMs);
}
