import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { datamartBase, DD_URL, fetchBytes, NotFoundError } from "../src/providers/datamart.js";
import { DownloadCounters } from "../src/providers/transport.js";
import { noSleep, stubFetch, useCleanWireEnv } from "./helpers/wire.js";

useCleanWireEnv();

describe("datamartBase", () => {
  it("defaults to dd", () => {
    expect(datamartBase()).toBe("https://dd.weather.gc.ca");
    expect(datamartBase()).toBe(DD_URL);
  });

  it("reads the override per call, trailing slash stripped", () => {
    process.env["METEO_DATAMART_BASE"] = "https://hpfx.collab.science.gc.ca/";
    expect(datamartBase()).toBe("https://hpfx.collab.science.gc.ca");
  });
});

describe("fetchBytes", () => {
  it("returns the body and records the telemetry once", async () => {
    const wire = stubFetch([{ status: 200, body: "GRIB-bytes" }]);
    const stats = new DownloadCounters();

    const body = await fetchBytes("https://dd.weather.gc.ca/file.grib2", {
      fetch: wire.fetch,
      stats,
    });

    expect(new TextDecoder().decode(body)).toBe("GRIB-bytes");
    expect(stats.requests).toBe(1);
    expect(stats.retries).toBe(0);
    expect(stats.responseBytes).toBe(10);
  });

  it("a 404 is NotFoundError and never retried", async () => {
    const wire = stubFetch([{ status: 404 }]);
    const stats = new DownloadCounters();

    await expect(
      fetchBytes("https://dd.weather.gc.ca/nowhere.grib2", { fetch: wire.fetch, stats }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(stats.requests).toBe(1);
    expect(stats.retries).toBe(0);
    expect(wire.requests).toHaveLength(1);
  });

  it("other client errors stay fatal but are not not-found", async () => {
    const wire = stubFetch([{ status: 403 }]);

    const failure: unknown = await fetchBytes("https://dd.weather.gc.ca/forbidden.grib2", {
      fetch: wire.fetch,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(NotFoundError);
    expect((failure as Error).message).toMatch(/failed with 403/);
    expect(wire.requests).toHaveLength(1);
  });

  it("server errors are retried before failing", async () => {
    const wire = stubFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    const stats = new DownloadCounters();

    await expect(
      fetchBytes("https://dd.weather.gc.ca/flaky.grib2", {
        fetch: wire.fetch,
        stats,
        sleep: noSleep,
      }),
    ).rejects.toThrowError(/failed with 500/);
    expect(stats.requests).toBe(3);
    expect(stats.retries).toBe(2);
  });

  it("throttling burns a retry and can recover", async () => {
    const wire = stubFetch([{ status: 429 }, { status: 200, body: "recovered" }]);
    const stats = new DownloadCounters();

    const body = await fetchBytes("https://dd.weather.gc.ca/busy.grib2", {
      fetch: wire.fetch,
      stats,
      sleep: noSleep,
    });

    expect(new TextDecoder().decode(body)).toBe("recovered");
    expect(stats.requests).toBe(2);
    expect(stats.retries).toBe(1);
    expect(stats.responseBytes).toBe(9);
  });

  it("transport errors burn a retry too", async () => {
    const wire = stubFetch([new Error("socket reset"), { status: 200, body: "ok" }]);

    const body = await fetchBytes("https://dd.weather.gc.ca/flaky.grib2", {
      fetch: wire.fetch,
      sleep: noSleep,
    });

    expect(new TextDecoder().decode(body)).toBe("ok");
    expect(wire.requests).toHaveLength(2);
  });

  it("backs off 0.25·2^n seconds, jittered ±25%", async () => {
    const wire = stubFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    const delays: number[] = [];
    const jitter = [0, 1];

    await expect(
      fetchBytes("https://dd.weather.gc.ca/flaky.grib2", {
        fetch: wire.fetch,
        sleep: async (ms) => {
          delays.push(ms);
        },
        random: () => jitter.shift()!,
      }),
    ).rejects.toThrowError();

    expect(delays).toEqual([187.5, 625]);
  });

  it("a Content-Length mismatch is retried, never returned", async () => {
    const wire = stubFetch([
      { status: 200, body: "wrong", headers: { "content-length": "10" } },
      { status: 200, body: "the-real-b", headers: { "content-length": "10" } },
    ]);
    const stats = new DownloadCounters();

    const body = await fetchBytes("https://dd.weather.gc.ca/file.grib2", {
      fetch: wire.fetch,
      stats,
      sleep: noSleep,
    });

    expect(new TextDecoder().decode(body)).toBe("the-real-b");
    expect(stats.requests).toBe(2);
    expect(stats.retries).toBe(1);
    expect(stats.responseBytes).toBe(10);
  });

  it("a mismatch on every attempt exhausts the budget and names the disagreement", async () => {
    const wire = stubFetch(
      Array.from({ length: 3 }, () => ({
        status: 200,
        body: "wrong",
        headers: { "content-length": "10" },
      })),
    );

    await expect(
      fetchBytes("https://dd.weather.gc.ca/file.grib2", { fetch: wire.fetch, sleep: noSleep }),
    ).rejects.toThrowError(/returned 5 bytes against Content-Length 10/);
    expect(wire.requests).toHaveLength(3);
  });

  it("an encoded response skips the length check — fetch already decoded it", async () => {
    const wire = stubFetch([
      {
        status: 200,
        body: "decoded-body",
        headers: { "content-length": "5", "content-encoding": "gzip" },
      },
    ]);

    const body = await fetchBytes("https://dd.weather.gc.ca/listing", { fetch: wire.fetch });

    expect(new TextDecoder().decode(body)).toBe("decoded-body");
    expect(wire.requests).toHaveLength(1);
  });

  it("a response without Content-Length is not checkable and returns", async () => {
    const wire = stubFetch([{ status: 200, body: "chunked" }]);
    const body = await fetchBytes("https://dd.weather.gc.ca/file.grib2", { fetch: wire.fetch });
    expect(new TextDecoder().decode(body)).toBe("chunked");
  });
});

describe("fetchBytes over a live socket", () => {
  async function serve(
    handler: Parameters<typeof createServer>[1],
  ): Promise<{ server: Server; url: string }> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { server, url: `http://127.0.0.1:${port}/file.grib2` };
  }

  it("an identity response passes the live length check byte for byte", async () => {
    const payload = Buffer.from("GRIB2-payload-bytes");
    const { server, url } = await serve((request, response) => {
      expect(request.method).toBe("GET");
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(payload.length),
      });
      response.end(payload);
    });
    try {
      const stats = new DownloadCounters();
      const body = await fetchBytes(url, { stats });
      expect(Buffer.from(body).equals(payload)).toBe(true);
      expect(stats.requests).toBe(1);
      expect(stats.retries).toBe(0);
      expect(stats.responseBytes).toBe(payload.length);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("a gzip response returns DECODED bytes without a phantom mismatch retry", async () => {
    const decoded = Buffer.from("one JSON line per run\n".repeat(64));
    const encoded = gzipSync(decoded);
    expect(encoded.length).not.toBe(decoded.length);
    const { server, url } = await serve((_request, response) => {
      response.writeHead(200, {
        "content-encoding": "gzip",
        "content-length": String(encoded.length),
      });
      response.end(encoded);
    });
    try {
      const stats = new DownloadCounters();
      const body = await fetchBytes(url, { stats });
      expect(Buffer.from(body).equals(decoded)).toBe(true);
      expect(stats.requests).toBe(1);
      expect(stats.retries).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("DownloadCounters transport report", () => {
  it("stays silent when nothing was timed", () => {
    expect(new DownloadCounters().transportReport()).toEqual([]);
  });

  it("reports totals, busy union, concurrency, and per-host rows", () => {
    let tick = 0;
    const stats = new DownloadCounters(() => tick);
    const first = stats.timeRequest("https://example.test/a");
    tick = 100;
    const second = stats.timeRequest("https://example.test/b");
    tick = 200;
    first(1024 * 1024, true);
    tick = 300;
    second(1024 * 1024, true);
    tick = 400;
    const third = stats.timeRequest("https://other.test/c");
    tick = 500;
    third(0, false);
    third(1024 * 1024, true); // settle is one-shot: this must not double-count
    tick = 1000;

    const report = stats.transportReport();
    expect(report[0]).toBe("[wire] 3 requests (1 failed), 2.0 MiB, wall 1.0 s");
    // Busy union [0,300] + [400,500] = 400 ms; in-flight sum 500 ms.
    expect(report[1]).toContain("wire-busy 0.4 s (40% of wall)");
    expect(report[1]).toContain("busy throughput 5.0 MiB/s");
    expect(report[2]).toContain("p50 200 ms");
    expect(report[2]).toContain("max 0.2 s");
    expect(report[3]).toMatch(/^\[wire\] cpu user /);
    expect(report[4]).toBe("[wire]   example.test: 2 requests, 2.0 MiB, mean 200 ms");
    expect(report[5]).toBe("[wire]   other.test: 1 requests, 0.0 MiB, mean 100 ms, 1 failed");
  });
});
