import {
  UPSTREAM_FAILURE_REASONS,
  UpstreamError,
  unavailableReasonForError,
  type UpstreamErrorReason,
  type UpstreamFailureReason,
} from "@azohra/meteo.core";

export {
  UPSTREAM_FAILURE_REASONS,
  UpstreamError,
  unavailableReasonForError,
  type UpstreamErrorReason,
  type UpstreamFailureReason,
};

export type FeedCache = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
};

export type LogEventCode =
  | "config_invalid"
  | "duplicate_station"
  | "upstream_failure"
  | "adapter_threw"
  | "custom_contract_break"
  | "clock_skew"
  | "resolver_invalid";

export type LogEvent = {
  level: "warn" | "error";
  code: LogEventCode;
  message: string;
  detail?: unknown;
};

export type ServerEnvironment = {
  fetch?: typeof fetch;
  cache?: FeedCache;
  logger?: (event: LogEvent) => void;
  userAgent?: string;
  now?: () => Date;
};

export type ResolvedEnvironment = Required<ServerEnvironment>;

export const UPSTREAM_FETCH_TIMEOUT_MS = 4_000;
export const UPSTREAM_RESPONSE_LIMIT_BYTES = 524_288;

const MEMORY_CACHE_MAX_ENTRIES = 500;

export function memoryCache(): FeedCache {
  const entries = new Map<string, { value: string; expiresAtMs: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (Date.now() >= entry.expiresAtMs) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, ttlSeconds) {
      entries.delete(key);
      entries.set(key, { value, expiresAtMs: Date.now() + ttlSeconds * 1_000 });
      while (entries.size > MEMORY_CACHE_MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
  };
}

const sharedDefaultCache = memoryCache();

function consoleLogger(event: LogEvent): void {
  const log = event.level === "warn" ? console.warn : console.error;
  if (event.detail === undefined) {
    log(`[azohra-meteo] ${event.message}`);
  } else {
    log(`[azohra-meteo] ${event.message}`, event.detail);
  }
}

export const DEFAULT_USER_AGENT = "azohra-meteo/0.1 (+https://meteo.azohra.com)";

export function resolveEnvironment(environment: ServerEnvironment = {}): ResolvedEnvironment {
  return {
    fetch: environment.fetch ?? globalThis.fetch.bind(globalThis),
    cache: environment.cache ?? sharedDefaultCache,
    logger: environment.logger ?? consoleLogger,
    userAgent: environment.userAgent ?? DEFAULT_USER_AGENT,
    now: environment.now ?? (() => new Date()),
  };
}

export type UpstreamTextRequest = {
  url: string | URL;
  /* Never derive the key from the raw URL: a sliding time window in the
   * query would defeat the cache, and keys must name the upstream itself,
   * never a host-chosen station label. */
  cacheKey: string;
  cacheTtlSeconds: number;
  subject: string;
  accept?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: BodyInit;
  timeoutMs?: number;
  limitBytes?: number;
};

const inFlightLoads = new WeakMap<FeedCache, Map<string, Promise<string>>>();

/**
 * The one road to an upstream: cache lookup, bounded fetch under a timeout,
 * cache fill. Concurrent misses on the same (cache instance, cacheKey)
 * coalesce onto a single in-flight load.
 */
export async function fetchUpstreamText(
  environment: ResolvedEnvironment,
  request: UpstreamTextRequest,
): Promise<string> {
  const cached = await environment.cache.get(request.cacheKey);
  if (cached != null) return cached;

  let pending = inFlightLoads.get(environment.cache);
  if (!pending) {
    pending = new Map();
    inFlightLoads.set(environment.cache, pending);
  }
  const inFlight = pending.get(request.cacheKey);
  if (inFlight) return inFlight;

  const settled = pending;
  const load = loadUpstreamText(environment, request).finally(() => {
    settled.delete(request.cacheKey);
  });
  pending.set(request.cacheKey, load);
  return load;
}

async function loadUpstreamText(
  environment: ResolvedEnvironment,
  request: UpstreamTextRequest,
): Promise<string> {
  let response: Response;
  try {
    response = await environment.fetch(request.url, {
      method: request.method,
      body: request.body,
      headers: {
        Accept: request.accept ?? "application/json",
        "User-Agent": environment.userAgent,
        ...request.headers,
      },
      signal: AbortSignal.timeout(request.timeoutMs ?? UPSTREAM_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new UpstreamError(`${request.subject} timed out`, "timeout");
    }
    throw new UpstreamError(
      `${request.subject} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      /* best-effort */
    }
    if (response.status === 429) {
      throw new UpstreamError(`${request.subject} is rate limiting requests`, "rate_limited");
    }
    throw new UpstreamError(`${request.subject} returned ${response.status}`);
  }

  const text = await boundedResponseText(
    response,
    request.limitBytes ?? UPSTREAM_RESPONSE_LIMIT_BYTES,
    request.subject,
  );
  await environment.cache.put(request.cacheKey, text, request.cacheTtlSeconds);
  return text;
}

export async function boundedResponseText(
  response: Response,
  limitBytes: number,
  subject: string,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new UpstreamError(`${subject} returned no body`);
  const decoder = new TextDecoder();
  let result = "";
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) return result + decoder.decode();
    totalBytes += value.byteLength;
    if (totalBytes > limitBytes) {
      await reader.cancel();
      throw new UpstreamError(`${subject} exceeded the response limit`);
    }
    result += decoder.decode(value, { stream: true });
  }
}

export function logUpstreamFailure(
  environment: ResolvedEnvironment,
  message: string,
  error: unknown,
  detail: Record<string, unknown> = {},
): void {
  environment.logger({
    level: "error",
    code: "upstream_failure",
    message,
    detail: {
      error: error instanceof Error ? error.message : String(error),
      ...detail,
    },
  });
}
