import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manifestStats } from "../src/publish.js";
import {
  DownloadCounters,
  exists,
  keepAliveFetch,
  USER_AGENT,
} from "../src/providers/transport.js";
import { stubFetch } from "./helpers/wire.js";

describe("USER_AGENT", () => {
  it("carries the package version, with the 0.dev source-tree fallback", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    ) as { version?: string };
    expect(USER_AGENT).toBe(
      `azohra-meteo/${manifest.version ?? "0.dev"} (+https://github.com/azohra/meteo)`,
    );
  });
});

describe("DownloadCounters", () => {
  it("counts every attempt as a request and retried attempts as retries too", () => {
    const stats = new DownloadCounters();
    stats.recordRequest(false);
    stats.recordRequest(true);
    stats.recordRequest(true);
    expect(stats.requests).toBe(3);
    expect(stats.retries).toBe(2);
    expect(stats.responseBytes).toBe(0);
  });

  it("accumulates response bytes", () => {
    const stats = new DownloadCounters();
    stats.recordBytes(1024);
    stats.recordBytes(76);
    expect(stats.responseBytes).toBe(1100);
  });

  it("satisfies the DownloadStats view the manifest stats block reads", () => {
    const stats = new DownloadCounters();
    stats.recordRequest(false);
    stats.recordRequest(true);
    stats.recordBytes(512);
    const block = manifestStats(stats, performance.now());
    expect(block["downloads"]).toBe(2);
    expect(block["retries"]).toBe(1);
    expect(block["downloadBytes"]).toBe(512);
  });
});

describe("exists", () => {
  it("answers true exactly for a 200", async () => {
    const ok = stubFetch([{ status: 200 }]);
    expect(await exists("https://dd.weather.gc.ca/there.grib2", ok.fetch)).toBe(true);

    const missing = stubFetch([{ status: 404 }]);
    expect(await exists("https://dd.weather.gc.ca/nowhere.grib2", missing.fetch)).toBe(false);
  });

  it("sends a HEAD carrying the shared User-Agent and a timeout", async () => {
    const wire = stubFetch([{ status: 200 }]);
    await exists("https://dd.weather.gc.ca/there.grib2", wire.fetch);

    expect(wire.requests).toHaveLength(1);
    const { url, init } = wire.requests[0];
    expect(url).toBe("https://dd.weather.gc.ca/there.grib2");
    expect(init?.method).toBe("HEAD");
    expect(init?.headers?.["user-agent"]).toBe(USER_AGENT);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("keepAliveFetch", () => {
  async function apacheLike(
    body: string | Buffer,
    extraHeaders = "Upgrade: h2,h2c\r\nConnection: Upgrade, Keep-Alive\r\nKeep-Alive: timeout=2, max=100\r\n",
    status = "200 OK",
  ): Promise<{ url: string; connections: () => number; close: () => Promise<void> }> {
    const { createServer } = await import("node:net");
    const payload = typeof body === "string" ? Buffer.from(body) : body;
    let connections = 0;
    const sockets = new Set<import("node:net").Socket>();
    const server = createServer((socket) => {
      connections += 1;
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("data", () => {
        socket.write(
          `HTTP/1.1 ${status}\r\nServer: Apache\r\n${extraHeaders}` +
            `Content-Length: ${payload.byteLength}\r\n\r\n`,
        );
        socket.write(payload);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    return {
      url: `http://127.0.0.1:${address.port}/file.grib2`,
      connections: () => connections,
      close: () =>
        new Promise<void>((resolve) => {
          // Destroy the kept-alive client socket or server.close() waits forever.
          for (const socket of sockets) socket.destroy();
          server.close(() => resolve());
        }),
    };
  }

  it("reuses one connection across sequential requests despite Connection: Upgrade", async () => {
    const server = await apacheLike("GRIB-bytes");
    try {
      for (let i = 0; i < 3; i += 1) {
        const response = await keepAliveFetch(server.url, {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(5000),
        });
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("GRIB-bytes");
      }
      expect(server.connections()).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("exposes headers case-insensitively and drains unread non-200 bodies", async () => {
    const server = await apacheLike("gone", undefined, "404 Not Found");
    try {
      const response = await keepAliveFetch(server.url);
      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Length")).toBe("4");
      expect(response.headers.get("server")).toBe("Apache");
      expect(response.headers.get("x-absent")).toBeNull();
      await response.arrayBuffer();
      const again = await keepAliveFetch(server.url);
      expect(again.status).toBe(404);
      expect(server.connections()).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("an aborted signal rejects, before and during the request", async () => {
    const aborted = AbortSignal.abort(new Error("stood down"));
    await expect(keepAliveFetch("http://127.0.0.1:1/x", { signal: aborted })).rejects.toThrow(
      "stood down",
    );

    // A paused stream would never surface the client's FIN; close() would wait forever.
    const { createServer } = await import("node:net");
    let closedByClient = false;
    const silent = createServer((socket) => {
      socket.resume();
      socket.on("close", () => {
        closedByClient = true;
      });
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as { port: number }).port;
    try {
      await expect(
        keepAliveFetch(`http://127.0.0.1:${port}/never`, { signal: AbortSignal.timeout(50) }),
      ).rejects.toThrow();
      await expect.poll(() => closedByClient).toBe(true);
    } finally {
      await new Promise<void>((resolve) => {
        silent.close(() => resolve());
      });
    }
  });

  it("decompresses a gzip body a server sends unbidden, like fetch", async () => {
    const { gzipSync } = await import("node:zlib");
    const decoded = "unsolicited but handled";
    const encoded = gzipSync(Buffer.from(decoded));
    const server = await apacheLike(
      encoded,
      "Connection: Keep-Alive\r\nContent-Encoding: gzip\r\n",
    );
    try {
      const response = await keepAliveFetch(server.url);
      expect(response.headers.get("content-encoding")).toBe("gzip");
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(decoded);
    } finally {
      await server.close();
    }
  });
});
