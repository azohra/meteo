import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_USER_AGENT,
  fetchUpstreamText,
  memoryCache,
  resolveEnvironment,
  unavailableReasonForError,
  UpstreamError,
} from "../src/server/index.js";

function textRequest(cacheKey: string) {
  return {
    url: "http://upstream.example/data",
    cacheKey,
    cacheTtlSeconds: 60,
    subject: "test upstream",
  };
}

describe("resolveEnvironment defaults", () => {
  it("routes the default logger to the console by level", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { logger } = resolveEnvironment();
      logger({
        level: "warn",
        code: "clock_skew",
        message: "clock skew",
        detail: { station: "summit" },
      });
      logger({ level: "error", code: "upstream_failure", message: "upstream down" });
      expect(warn).toHaveBeenCalledWith("[azohra-meteo] clock skew", { station: "summit" });
      expect(error).toHaveBeenCalledWith("[azohra-meteo] upstream down");
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("prefers an injected logger over the console", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const events: unknown[] = [];
      const { logger } = resolveEnvironment({ logger: (event) => events.push(event) });
      logger({ level: "warn", code: "clock_skew", message: "quiet" });
      expect(events).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("identifies itself to upstreams with the fixed protocol identity, never the package version", async () => {
    expect(DEFAULT_USER_AGENT).toBe("azohra-meteo/0.1 (+https://meteo.azohra.com)");
    expect(resolveEnvironment().userAgent).toBe(DEFAULT_USER_AGENT);

    let sent: string | undefined;
    const environment = resolveEnvironment({
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        sent = new Headers(init?.headers).get("User-Agent") ?? undefined;
        return new Response("ok");
      }) as typeof fetch,
      cache: memoryCache(),
    });
    await fetchUpstreamText(environment, textRequest("test/user-agent"));
    expect(sent).toBe(DEFAULT_USER_AGENT);
  });
});

describe("fetchUpstreamText", () => {
  it("coalesces concurrent misses into one upstream hit", async () => {
    let calls = 0;
    const environment = resolveEnvironment({
      fetch: (async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response("payload");
      }) as typeof fetch,
      cache: memoryCache(),
    });

    const results = await Promise.all(
      [0, 1, 2].map(() => fetchUpstreamText(environment, textRequest("test/coalesce"))),
    );
    expect(results).toEqual(["payload", "payload", "payload"]);
    expect(calls).toBe(1);
  });

  it("clears the in-flight slot on failure so the next call retries", async () => {
    let calls = 0;
    const environment = resolveEnvironment({
      fetch: (async () => {
        calls += 1;
        return new Response("down", { status: 503 });
      }) as typeof fetch,
      cache: memoryCache(),
    });

    await expect(fetchUpstreamText(environment, textRequest("test/retry"))).rejects.toThrow(
      "returned 503",
    );
    await expect(fetchUpstreamText(environment, textRequest("test/retry"))).rejects.toThrow(
      "returned 503",
    );
    expect(calls).toBe(2);
  });

  it("maps HTTP 429 to rate_limited", async () => {
    const environment = resolveEnvironment({
      fetch: (async () => new Response("slow down", { status: 429 })) as typeof fetch,
      cache: memoryCache(),
    });

    const error: unknown = await fetchUpstreamText(environment, textRequest("test/429")).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(UpstreamError);
    if (!(error instanceof UpstreamError)) return;
    expect(error.reason).toBe("rate_limited");
    expect(unavailableReasonForError(error)).toBe("rate_limited");
  });

  it("merges caller headers over the defaults — a caller replaces them only with the exact 'Accept'/'User-Agent' casing", async () => {
    let sent: Headers | undefined;
    const environment = resolveEnvironment({
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        sent = new Headers(init?.headers);
        return new Response("ok");
      }) as typeof fetch,
      cache: memoryCache(),
    });
    await fetchUpstreamText(environment, {
      ...textRequest("test/headers"),
      headers: { Accept: "text/csv", Authorization: "Bearer tok" },
    });
    expect(sent?.get("Accept")).toBe("text/csv");
    expect(sent?.get("Authorization")).toBe("Bearer tok");
    expect(sent?.get("User-Agent")).toBe(DEFAULT_USER_AGENT);
  });

  it("forwards method and body", async () => {
    let seen: { method?: string; body?: unknown } = {};
    const environment = resolveEnvironment({
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        seen = { method: init?.method, body: init?.body };
        return new Response("ok");
      }) as typeof fetch,
      cache: memoryCache(),
    });
    await fetchUpstreamText(environment, {
      ...textRequest("test/method"),
      method: "POST",
      body: '{"query":"latest"}',
    });
    expect(seen.method).toBe("POST");
    expect(seen.body).toBe('{"query":"latest"}');
  });

  it("cancels an error response's body instead of leaking it", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const environment = resolveEnvironment({
      fetch: (async () => new Response(body, { status: 500 })) as typeof fetch,
      cache: memoryCache(),
    });

    await expect(fetchUpstreamText(environment, textRequest("test/body"))).rejects.toThrow(
      "returned 500",
    );
    expect(cancelled).toBe(true);
  });
});

describe("memoryCache", () => {
  it("evicts the oldest write once past the entry bound", async () => {
    const cache = memoryCache();
    for (let index = 0; index <= 500; index += 1) {
      await cache.put(`key-${index}`, `value-${index}`, 60);
    }
    expect(await cache.get("key-0")).toBeNull();
    expect(await cache.get("key-1")).toBe("value-1");
    expect(await cache.get("key-500")).toBe("value-500");
  });

  it("refreshing a key moves it out of eviction's way", async () => {
    const cache = memoryCache();
    for (let index = 0; index < 500; index += 1) {
      await cache.put(`key-${index}`, `value-${index}`, 60);
    }
    await cache.put("key-0", "refreshed", 60);
    await cache.put("overflow", "value", 60);
    expect(await cache.get("key-0")).toBe("refreshed");
    expect(await cache.get("key-1")).toBeNull();
  });
});
