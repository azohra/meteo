import { Agent as HttpAgent, request as httpRequest, type IncomingMessage } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

export type {
  BinaryTransportFetch as TransportFetch,
  BinaryTransportResponse as TransportResponse,
  TransportInit,
} from "@azohra/meteo.briefing/transport";
import type {
  BinaryTransportFetch as TransportFetch,
  BinaryTransportResponse as TransportResponse,
  TransportInit,
} from "@azohra/meteo.briefing/transport";

function packageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    ) as { version?: string };
    return manifest.version ?? "0.dev";
  } catch {
    return "0.dev";
  }
}

export const USER_AGENT = `azohra-meteo/${packageVersion()} (+https://github.com/azohra/meteo)`;

let httpAgent: HttpAgent | undefined;
let httpsAgent: HttpsAgent | undefined;

function agentFor(protocol: string): HttpAgent | HttpsAgent {
  if (protocol === "https:") {
    httpsAgent ??= new HttpsAgent({ keepAlive: true });
    return httpsAgent;
  }
  httpAgent ??= new HttpAgent({ keepAlive: true });
  return httpAgent;
}

function exactArrayBuffer(body: Buffer): ArrayBuffer {
  if (body.byteOffset === 0 && body.byteLength === body.buffer.byteLength) {
    return body.buffer as ArrayBuffer;
  }
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

function decodeBody(body: Buffer, contentEncoding: string | undefined): Buffer {
  if (contentEncoding === undefined || contentEncoding === "") return body;
  const codings = contentEncoding
    .split(",")
    .map((coding) => coding.trim().toLowerCase())
    .reverse();
  let decoded = body;
  for (const coding of codings) {
    if (coding === "gzip" || coding === "x-gzip") {
      decoded = gunzipSync(decoded);
    } else if (coding === "deflate") {
      try {
        decoded = inflateSync(decoded);
      } catch {
        decoded = inflateRawSync(decoded);
      }
    } else if (coding === "br") {
      decoded = brotliDecompressSync(decoded);
    } else if (coding !== "identity") {
      return body;
    }
  }
  return decoded;
}

function bufferBody(response: IncomingMessage, signal?: AbortSignal): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => {
      try {
        const raw = Buffer.concat(chunks);
        const encoding = response.headers["content-encoding"];
        resolve(
          exactArrayBuffer(decodeBody(raw, Array.isArray(encoding) ? encoding[0] : encoding)),
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    response.on("error", reject);
    response.on("close", () => {
      if (!response.complete) {
        reject(signal?.aborted ? abortError(signal) : new Error("connection closed mid-body"));
      }
    });
  });
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(String(reason ?? "request aborted"));
}

export function keepAliveFetch(url: string, init: TransportInit = {}): Promise<TransportResponse> {
  return new Promise<TransportResponse>((resolve, reject) => {
    const target = new URL(url);
    const signal = init.signal;
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const request = target.protocol === "https:" ? httpsRequest : httpRequest;
    const clientRequest = request(
      target,
      {
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        agent: agentFor(target.protocol),
      },
      (response) => {
        const body = bufferBody(response, signal);
        body.catch(() => undefined);
        body.finally(cleanup).catch(() => undefined);
        resolve({
          status: response.statusCode ?? 0,
          headers: {
            get: (name: string): string | null => {
              const value = response.headers[name.toLowerCase()];
              return value === undefined ? null : Array.isArray(value) ? value.join(", ") : value;
            },
          },
          arrayBuffer: () => body,
        });
      },
    );
    const onAbort = (): void => {
      clientRequest.destroy(abortError(signal!));
    };
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    clientRequest.on("error", (error) => {
      cleanup();
      reject(signal?.aborted ? abortError(signal) : error);
    });
    clientRequest.end();
  });
}

export const REQUEST_TIMEOUT_S = 60;

interface WireHostRow {
  requests: number;
  bytes: number;
  ms: number;
  failures: number;
}

export class DownloadCounters {
  requests = 0;
  responseBytes = 0;
  retries = 0;

  readonly #now: () => number;
  readonly #startedAt: number;
  readonly #cpuStart = process.cpuUsage();
  readonly #durationsMs: number[] = [];
  readonly #hosts = new Map<string, WireHostRow>();
  #active = 0;
  #busyMs = 0;
  #lastTransitionAt: number;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
    this.#startedAt = now();
    this.#lastTransitionAt = this.#startedAt;
  }

  recordRequest(retry: boolean): void {
    this.requests += 1;
    if (retry) {
      this.retries += 1;
    }
  }

  recordBytes(count: number): void {
    this.responseBytes += count;
  }

  /**
   * Times one transport attempt from dispatch to body completion. The
   * returned settle records the attempt's host row exactly once however
   * the attempt ends; `ok: false` marks it failed.
   */
  timeRequest(url: string): (bytes: number, ok: boolean) => void {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      host = "unknown";
    }
    const begunAt = this.#transition(1);
    let settled = false;
    return (bytes, ok) => {
      if (settled) return;
      settled = true;
      const ms = this.#transition(-1) - begunAt;
      this.#durationsMs.push(ms);
      const row = this.#hosts.get(host) ?? { requests: 0, bytes: 0, ms: 0, failures: 0 };
      row.requests += 1;
      row.bytes += bytes;
      row.ms += ms;
      if (!ok) row.failures += 1;
      this.#hosts.set(host, row);
    };
  }

  /**
   * One `[wire]` block for the build log: totals, busy time against wall,
   * mean concurrency, latency percentiles, cpu split, and a per-host row.
   * Empty when no timed request ran. Reading it: busy ≈ wall with
   * concurrency pinned at the builder's gate and low throughput means the
   * build is wire-bound; cpu ≈ wall means compute-bound; high p50 against
   * small mean sizes means round-trip-bound.
   */
  transportReport(): string[] {
    if (this.#durationsMs.length === 0) {
      return [];
    }
    let busyMs = this.#busyMs;
    if (this.#active > 0) {
      busyMs += this.#now() - this.#lastTransitionAt;
    }
    const safeBusyMs = Math.max(busyMs, 1);
    const wallMs = Math.max(this.#now() - this.#startedAt, 1);
    const cpu = process.cpuUsage(this.#cpuStart);
    const sorted = [...this.#durationsMs].sort((a, b) => a - b);
    const quantile = (q: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    const inFlightMs = sorted.reduce((total, ms) => total + ms, 0);
    const rows = [...this.#hosts.entries()];
    const bytes = rows.reduce((total, [, row]) => total + row.bytes, 0);
    const failures = rows.reduce((total, [, row]) => total + row.failures, 0);
    const mib = (count: number): string => (count / (1024 * 1024)).toFixed(1);
    const s = (ms: number): string => (ms / 1000).toFixed(1);
    return [
      `[wire] ${this.#durationsMs.length} requests (${failures} failed), ${mib(bytes)} MiB, wall ${s(wallMs)} s`,
      `[wire] wire-busy ${s(busyMs)} s (${Math.round((busyMs / wallMs) * 100)}% of wall) · ` +
        `mean concurrency ${(inFlightMs / safeBusyMs).toFixed(1)} · ` +
        `busy throughput ${mib(bytes / (safeBusyMs / 1000))} MiB/s`,
      `[wire] request latency p50 ${quantile(0.5).toFixed(0)} ms · p90 ${quantile(0.9).toFixed(0)} ms · ` +
        `max ${s(sorted[sorted.length - 1]!)} s · mean size ${mib(bytes / this.#durationsMs.length)} MiB`,
      `[wire] cpu user ${s(cpu.user / 1000)} s · system ${s(cpu.system / 1000)} s`,
      ...rows.map(
        ([host, row]) =>
          `[wire]   ${host}: ${row.requests} requests, ${mib(row.bytes)} MiB, ` +
          `mean ${(row.ms / row.requests).toFixed(0)} ms${row.failures > 0 ? `, ${row.failures} failed` : ""}`,
      ),
    ];
  }

  #transition(delta: number): number {
    const now = this.#now();
    if (this.#active > 0) {
      this.#busyMs += now - this.#lastTransitionAt;
    }
    this.#lastTransitionAt = now;
    this.#active += delta;
    return now;
  }
}

export async function exists(
  url: string,
  fetchImpl: TransportFetch = keepAliveFetch,
): Promise<boolean> {
  const response = await fetchImpl(url, {
    method: "HEAD",
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
  });
  return response.status === 200;
}
