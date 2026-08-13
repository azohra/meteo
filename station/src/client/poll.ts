export type PollError =
  | { kind: "network"; status?: number }
  | { kind: "contract"; cause?: unknown };

export type ParseOutcome<T> = { ok: true; data: T } | { ok: false; cause: unknown };

export type PollSeed<T> = { data: T; receivedAtMs: number };

export type PollSnapshot<T> = {
  data: T | null;
  error: PollError | null;
  receivedAtMs: number | null;
};

export const REQUEST_TIMEOUT_MS = 15_000;

export const FRESHNESS_REEVALUATE_MS = 30_000;

export type JsonPollerOptions<T> = {
  parse: (text: string) => ParseOutcome<T>;
  intervalMsFor: (last: T | null) => number;
  fetchInit?: RequestInit | (() => RequestInit | undefined);
  initial?: PollSeed<T>;
};

export type JsonPoller<T> = {
  getSnapshot(): PollSnapshot<T>;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  refresh(): void;
};

type Loop = {
  disposed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  controller: AbortController | null;
  inFlight: boolean;
  onVisibilityChange: () => void;
};

export function createJsonPoller<T>(url: string, options: JsonPollerOptions<T>): JsonPoller<T> {
  const { parse, intervalMsFor, initial } = options;
  const fetchInitFor = (): RequestInit | undefined =>
    typeof options.fetchInit === "function" ? options.fetchInit() : options.fetchInit;

  let snapshot: PollSnapshot<T> =
    initial != null
      ? { data: initial.data, error: null, receivedAtMs: initial.receivedAtMs }
      : { data: null, error: null, receivedAtMs: null };
  const listeners = new Set<() => void>();
  let loop: Loop | null = null;

  const setSnapshot = (next: PollSnapshot<T>) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const hidden = () => typeof document !== "undefined" && document.hidden;

  const run = async (current: Loop): Promise<void> => {
    if (current.inFlight) return;
    current.inFlight = true;
    const requestController = new AbortController();
    current.controller = requestController;
    const deadline = setTimeout(() => requestController.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...fetchInitFor(),
        signal: requestController.signal,
      });
      const body = await response.text();
      if (current.disposed) return;
      if (!response.ok) {
        setSnapshot({ ...snapshot, error: { kind: "network", status: response.status } });
        return;
      }
      const parsed = parse(body);
      if (!parsed.ok) {
        setSnapshot({ ...snapshot, error: { kind: "contract", cause: parsed.cause } });
        return;
      }
      setSnapshot({ data: parsed.data, error: null, receivedAtMs: Date.now() });
    } catch {
      if (!current.disposed) setSnapshot({ ...snapshot, error: { kind: "network" } });
    } finally {
      clearTimeout(deadline);
      if (current.controller === requestController) current.controller = null;
      current.inFlight = false;
    }
  };

  const schedule = (current: Loop) => {
    current.timer = setTimeout(async () => {
      if (!hidden()) await run(current);
      if (!current.disposed) schedule(current);
    }, intervalMsFor(snapshot.data));
  };

  const start = () => {
    if (loop != null) return;
    const current: Loop = {
      disposed: false,
      timer: undefined,
      controller: null,
      inFlight: false,
      onVisibilityChange: () => {
        if (!hidden()) void run(current);
      },
    };
    loop = current;
    void run(current).then(() => {
      if (!current.disposed) schedule(current);
    });
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", current.onVisibilityChange);
    }
  };

  const stop = () => {
    const current = loop;
    if (current == null) return;
    loop = null;
    current.disposed = true;
    current.controller?.abort();
    if (current.timer != null) clearTimeout(current.timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", current.onVisibilityChange);
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    stop,
    refresh: () => {
      if (loop == null) return;
      stop();
      start();
    },
  };
}
